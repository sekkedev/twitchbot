import { app, BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { broadcast } from '../ipc/broadcast';
import { interpolate } from '../lib/command-logic';
import { awardExp } from './exp-engine';
import { getDatabase } from './database';
import { sendWebhook, type DiscordEmbed } from './discord-webhooks';
import { getCurrentTokens } from './twitch-auth';
import { sendChat } from './twitch-chat';
import { timeoutUser } from './twitch-helix';
import { onBotEvent, type BotEventMap, type BotEventUser } from './bot-events';

export type AutomationEventType =
  | 'follow'
  | 'subscription'
  | 'sub_gift'
  | 'cheer'
  | 'raid'
  | 'stream_online'
  | 'stream_offline';

type Operator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'not_contains';

export interface AutomationCondition {
  field: string;
  operator: Operator;
  value: string | number;
}

export type AutomationAction =
  | { type: 'send_chat_message'; message: string }
  | { type: 'play_sound'; file: string }
  | {
      type: 'send_discord_webhook';
      webhook_key: string;
      message?: string;
      embed?: DiscordEmbed;
    }
  | { type: 'timeout_user'; duration: number; reason?: string }
  | { type: 'add_exp'; amount: number }
  | { type: 'delay'; seconds: number };

export interface AutomationRow {
  id: number;
  name: string;
  enabled: boolean;
  event_type: AutomationEventType;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldown_seconds: number;
  last_triggered_at: number | null;
  created_at: number;
  updated_at: number;
}

interface AutomationDbRow {
  id: number;
  name: string;
  enabled: number;
  event_type: string;
  conditions: string;
  actions: string;
  cooldown_seconds: number;
  last_triggered_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface AutomationInput {
  name: string;
  enabled?: boolean;
  event_type: AutomationEventType;
  conditions?: AutomationCondition[];
  actions?: AutomationAction[];
  cooldown_seconds?: number;
}

export interface AutomationUpdate extends Partial<AutomationInput> {
  id: number;
}

export interface AutomationTestResult {
  matched: boolean;
  steps: Array<{ action: string; detail: string }>;
  skippedReason?: string;
}

export interface SoundFile {
  name: string;
  url: string;
}

interface AutomationContext {
  eventType: AutomationEventType;
  event: Record<string, unknown>;
  user: BotEventUser | null;
  variables: Record<string, string | number>;
}

const EVENT_TYPES: AutomationEventType[] = [
  'follow',
  'subscription',
  'sub_gift',
  'cheer',
  'raid',
  'stream_online',
  'stream_offline',
];

let automationsCache: AutomationRow[] = [];
let subscriptions: Array<() => void> = [];

export function startAutomationEngine(): void {
  reloadAutomations();
  if (subscriptions.length > 0) return;
  for (const eventType of EVENT_TYPES) {
    subscriptions.push(
      onBotEvent(eventType, (event) => {
        void handleEvent(eventType, event as BotEventMap[AutomationEventType]).catch(
          (err) => console.error('[auto] event failed:', err),
        );
      }),
    );
  }
}

export function stopAutomationEngine(): void {
  for (const unsubscribe of subscriptions) unsubscribe();
  subscriptions = [];
  automationsCache = [];
}

export function reloadAutomations(): void {
  automationsCache = listAutomations().filter((automation) => automation.enabled);
}

export function listAutomations(): AutomationRow[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM automations ORDER BY id DESC')
    .all() as AutomationDbRow[];
  return rows.map(rowToAutomation);
}

export function createAutomation(input: AutomationInput): AutomationRow {
  const count = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM automations')
    .get() as { count: number };
  if (count.count >= 20) throw new Error('Automations are limited to 20 total.');
  const normalized = normalizeAutomation(input);
  const info = getDatabase()
    .prepare(
      `INSERT INTO automations
       (name, enabled, event_type, conditions, actions, cooldown_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      normalized.name,
      normalized.enabled ? 1 : 0,
      normalized.event_type,
      JSON.stringify(normalized.conditions),
      JSON.stringify(normalized.actions),
      normalized.cooldown_seconds,
    );
  reloadAutomations();
  return getAutomation(Number(info.lastInsertRowid));
}

export function updateAutomation(update: AutomationUpdate): AutomationRow {
  const existing = getAutomation(update.id);
  const normalized = normalizeAutomation({
    name: update.name ?? existing.name,
    enabled: update.enabled ?? existing.enabled,
    event_type: update.event_type ?? existing.event_type,
    conditions: update.conditions ?? existing.conditions,
    actions: update.actions ?? existing.actions,
    cooldown_seconds: update.cooldown_seconds ?? existing.cooldown_seconds,
  });
  getDatabase()
    .prepare(
      `UPDATE automations
       SET name = ?, enabled = ?, event_type = ?, conditions = ?, actions = ?,
           cooldown_seconds = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .run(
      normalized.name,
      normalized.enabled ? 1 : 0,
      normalized.event_type,
      JSON.stringify(normalized.conditions),
      JSON.stringify(normalized.actions),
      normalized.cooldown_seconds,
      update.id,
    );
  reloadAutomations();
  return getAutomation(update.id);
}

export function deleteAutomation(id: number): void {
  const info = getDatabase().prepare('DELETE FROM automations WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error(`Automation ${id} not found.`);
  reloadAutomations();
}

export function toggleAutomation(id: number): AutomationRow {
  const existing = getAutomation(id);
  return updateAutomation({ id, enabled: !existing.enabled });
}

export function testAutomation(input: AutomationInput): AutomationTestResult {
  const automation = normalizeAutomation(input);
  const ctx = buildContext(automation.event_type, mockEvent(automation.event_type));
  const matched = conditionsMatch(automation.conditions, ctx);
  if (!matched) {
    return { matched: false, steps: [], skippedReason: 'conditions_not_met' };
  }
  return {
    matched: true,
    steps: automation.actions.map((action) => previewAction(action, ctx)),
  };
}

export async function listSounds(): Promise<SoundFile[]> {
  const dir = soundsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isSupportedSound(entry.name))
    .map((entry) => soundFile(entry.name));
}

export async function addSoundFromDialog(
  window: BrowserWindow | null,
): Promise<SoundFile[] | null> {
  const options: OpenDialogOptions = {
    title: 'Add sound',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return null;
  const dir = soundsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  for (const source of result.filePaths) {
    const name = path.basename(source);
    if (!isSupportedSound(name)) continue;
    await fs.promises.copyFile(source, path.join(dir, name));
  }
  return listSounds();
}

export async function deleteSound(name: string): Promise<void> {
  const safeName = path.basename(name);
  if (!isSupportedSound(safeName)) throw new Error('Unsupported sound file.');
  await fs.promises.rm(path.join(soundsDir(), safeName), { force: true });
}

export function getSoundsDirectory(): string {
  return soundsDir();
}

async function handleEvent(
  eventType: AutomationEventType,
  event: BotEventMap[AutomationEventType],
): Promise<void> {
  const ctx = buildContext(eventType, event);
  const matching = automationsCache.filter(
    (automation) =>
      automation.enabled &&
      automation.event_type === eventType &&
      conditionsMatch(automation.conditions, ctx) &&
      cooldownReady(automation),
  );

  for (const automation of matching) {
    await executeAutomation(automation, ctx);
  }
}

async function executeAutomation(
  automation: AutomationRow,
  ctx: AutomationContext,
): Promise<void> {
  for (const action of automation.actions) {
    try {
      await executeAction(action, ctx);
    } catch (err) {
      console.error(`[auto] action ${action.type} failed:`, err);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  getDatabase()
    .prepare('UPDATE automations SET last_triggered_at = ?, updated_at = unixepoch() WHERE id = ?')
    .run(now, automation.id);
  automation.last_triggered_at = now;
  broadcast('automations:triggered', { id: automation.id, timestamp: now });
}

async function executeAction(
  action: AutomationAction,
  ctx: AutomationContext,
): Promise<void> {
  switch (action.type) {
    case 'send_chat_message':
      await sendChat(resolveTemplate(action.message, ctx));
      break;
    case 'play_sound':
      broadcast('sound:play', soundFile(action.file));
      break;
    case 'send_discord_webhook':
      await sendWebhook(
        action.webhook_key,
        { content: action.message, embed: action.embed },
        ctx.variables,
      );
      break;
    case 'timeout_user':
      await timeoutTriggeringUser(ctx, action.duration, action.reason);
      break;
    case 'add_exp':
      addExpToTriggeringUser(ctx, action.amount);
      break;
    case 'delay':
      await sleep(Math.min(Math.max(action.seconds, 0), 30) * 1000);
      break;
  }
}

function conditionsMatch(
  conditions: AutomationCondition[],
  ctx: AutomationContext,
): boolean {
  return conditions.every((condition) => {
    const actual = ctx.event[condition.field];
    const expected = condition.value;
    switch (condition.operator) {
      case 'equals':
        return String(actual) === String(expected);
      case 'not_equals':
        return String(actual) !== String(expected);
      case 'greater_than':
        return Number(actual) > Number(expected);
      case 'less_than':
        return Number(actual) < Number(expected);
      case 'contains':
        return String(actual ?? '').includes(String(expected));
      case 'not_contains':
        return !String(actual ?? '').includes(String(expected));
      default:
        return false;
    }
  });
}

function cooldownReady(automation: AutomationRow): boolean {
  if (automation.cooldown_seconds <= 0 || !automation.last_triggered_at) return true;
  return Math.floor(Date.now() / 1000) - automation.last_triggered_at >= automation.cooldown_seconds;
}

function buildContext(
  eventType: AutomationEventType,
  event: BotEventMap[AutomationEventType],
): AutomationContext {
  const data = normalizeEventData(eventType, event);
  const user = getUserFromEvent(eventType, event);
  const tier = String(data.tier ?? '');
  const raidSize = Number(data.viewer_count ?? data.viewers ?? 0);
  const variables: Record<string, string | number> = {
    user: String(user?.displayName ?? data.fromDisplayName ?? data.fromChannel ?? 'stream'),
    event: eventType,

    // Raid
    raider: String(data.fromDisplayName ?? data.fromChannel ?? ''),
    raid_size: raidSize,
    raid_viewers: raidSize, // legacy alias — keep before renaming in templates
    from_channel: String(data.fromChannel ?? ''),

    // Subscription / gift
    tier,
    tier_label: formatTierLabel(tier),
    months: Number(data.months ?? 0),
    is_gift: data.isGift ? 'yes' : 'no',
    is_anonymous: data.isAnonymous ? 'yes' : 'no',
    total: Number(data.total ?? 0),
    sub_message: String(data.message ?? ''),

    // Cheer
    bits: Number(data.bits ?? 0),
    cheer_message: String(data.message ?? ''),

    // Generic
    timestamp: String(data.timestamp ?? new Date().toISOString()),
  };
  return { eventType, event: data, user, variables };
}

function formatTierLabel(tier: string): string {
  switch (tier) {
    case '1000':
      return 'Tier 1';
    case '2000':
      return 'Tier 2';
    case '3000':
      return 'Tier 3';
    case 'prime':
    case 'Prime':
      return 'Prime';
    default:
      return tier;
  }
}

function normalizeEventData(
  eventType: AutomationEventType,
  event: BotEventMap[AutomationEventType],
): Record<string, unknown> {
  switch (eventType) {
    case 'raid': {
      const raid = event as BotEventMap['raid'];
      return {
        ...raid,
        viewer_count: raid.viewers,
      };
    }
    case 'cheer':
      return event as Record<string, unknown>;
    case 'subscription':
      return event as Record<string, unknown>;
    case 'sub_gift':
      return event as Record<string, unknown>;
    default:
      return event as Record<string, unknown>;
  }
}

function getUserFromEvent(
  eventType: AutomationEventType,
  event: BotEventMap[AutomationEventType],
): BotEventUser | null {
  if (eventType === 'raid' || eventType === 'stream_online' || eventType === 'stream_offline') {
    return null;
  }
  const maybe = event as { user?: BotEventUser | null };
  return maybe.user ?? null;
}

function resolveTemplate(template: string, ctx: AutomationContext): string {
  return interpolate(template, ctx.variables);
}

async function timeoutTriggeringUser(
  ctx: AutomationContext,
  duration: number,
  reason?: string,
): Promise<void> {
  const tokens = getCurrentTokens();
  if (!tokens || !ctx.user) return;
  await timeoutUser(
    tokens.user.id,
    tokens.user.id,
    ctx.user.id,
    Math.max(1, Math.floor(duration)),
    reason ?? 'Automation',
  );
}

function addExpToTriggeringUser(ctx: AutomationContext, amount: number): void {
  if (!ctx.user) return;
  awardExp(ctx.user.id, ctx.user.displayName, Math.floor(amount), 'admin', {
    data: { automation: true, event: ctx.eventType },
  });
}

function previewAction(
  action: AutomationAction,
  ctx: AutomationContext,
): { action: string; detail: string } {
  switch (action.type) {
    case 'send_chat_message':
      return { action: action.type, detail: resolveTemplate(action.message, ctx) };
    case 'play_sound':
      return { action: action.type, detail: action.file };
    case 'send_discord_webhook': {
      const parts: string[] = [];
      if (action.message) parts.push(resolveTemplate(action.message, ctx));
      if (action.embed) parts.push('[embed]');
      return {
        action: action.type,
        detail: `${action.webhook_key}: ${parts.join(' ') || '(empty)'}`,
      };
    }
    case 'timeout_user':
      return { action: action.type, detail: `${action.duration}s` };
    case 'add_exp':
      return { action: action.type, detail: `${action.amount} EXP` };
    case 'delay':
      return { action: action.type, detail: `${action.seconds}s` };
  }
}

function getAutomation(id: number): AutomationRow {
  const row = getDatabase()
    .prepare('SELECT * FROM automations WHERE id = ?')
    .get(id) as AutomationDbRow | undefined;
  if (!row) throw new Error(`Automation ${id} not found.`);
  return rowToAutomation(row);
}

function normalizeAutomation(input: AutomationInput): Omit<AutomationRow, 'id' | 'last_triggered_at' | 'created_at' | 'updated_at'> {
  const name = input.name.trim();
  if (!name) throw new Error('Automation name cannot be empty.');
  if (!EVENT_TYPES.includes(input.event_type)) throw new Error('Invalid event type.');
  const actions = input.actions ?? [];
  const conditions = input.conditions ?? [];
  if (actions.length > 10) throw new Error('Automations can have at most 10 actions.');
  const cooldown = input.cooldown_seconds ?? 0;
  if (!Number.isInteger(cooldown) || cooldown < 0) {
    throw new Error('Cooldown must be a non-negative integer.');
  }
  validateJsonArray(conditions, 'conditions');
  validateJsonArray(actions, 'actions');
  return {
    name,
    enabled: input.enabled ?? true,
    event_type: input.event_type,
    conditions,
    actions,
    cooldown_seconds: cooldown,
  };
}

function validateJsonArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}

function rowToAutomation(row: AutomationDbRow): AutomationRow {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    event_type: row.event_type as AutomationEventType,
    conditions: safeParseArray<AutomationCondition>(row.conditions),
    actions: safeParseArray<AutomationAction>(row.actions),
    cooldown_seconds: row.cooldown_seconds,
    last_triggered_at: row.last_triggered_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeParseArray<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function mockEvent(eventType: AutomationEventType): BotEventMap[AutomationEventType] {
  const user = { id: '1234', login: 'viewer', displayName: 'Viewer' };
  switch (eventType) {
    case 'follow':
      return { user, timestamp: new Date().toISOString() };
    case 'subscription':
      return { user, tier: '1000', months: 3, isGift: false, timestamp: new Date().toISOString() };
    case 'sub_gift':
      return { user, total: 5, tier: '1000', isAnonymous: false, timestamp: new Date().toISOString() };
    case 'cheer':
      return { user, bits: 500, message: 'cheer!', timestamp: new Date().toISOString() };
    case 'raid':
      return {
        fromChannel: 'raider',
        fromDisplayName: 'Raider',
        viewers: 42,
        timestamp: new Date().toISOString(),
      };
    case 'stream_online':
      return { timestamp: new Date().toISOString() };
    case 'stream_offline':
      return { timestamp: new Date().toISOString() };
  }
}

function soundsDir(): string {
  return path.join(app.getPath('userData'), 'sounds');
}

function isSupportedSound(name: string): boolean {
  return /\.(mp3|wav)$/i.test(name);
}

function soundFile(name: string): SoundFile {
  const safeName = path.basename(name);
  return {
    name: safeName,
    url: pathToFileURL(path.join(soundsDir(), safeName)).toString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
