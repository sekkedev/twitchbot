import { buildCommandVariables, interpolate } from './command-engine';
import { getDatabase } from './database';
import { onBotEvent } from './bot-events';
import { getCurrentTokens } from './twitch-auth';
import { getBotState, sendChat, type ChatMessage } from './twitch-chat';

export interface TimerRow {
  id: number;
  name: string;
  message: string;
  interval_seconds: number;
  min_chat_lines: number;
  enabled: boolean;
  last_fired_at: number | null;
  created_at: number;
  updated_at: number;
}

interface TimerDbRow {
  id: number;
  name: string;
  message: string;
  interval_seconds: number;
  min_chat_lines: number;
  enabled: number;
  last_fired_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TimerInput {
  name: string;
  message: string;
  interval_seconds?: number;
  min_chat_lines?: number;
  enabled?: boolean;
}

export interface TimerUpdate {
  id: number;
  name?: string;
  message?: string;
  interval_seconds?: number;
  min_chat_lines?: number;
  enabled?: boolean;
}

const TICK_MS = 15_000;
const MAX_CHAT_LENGTH = 480;

let timerLoop: NodeJS.Timeout | null = null;
let unsubscribeChat: (() => void) | null = null;
const chatLinesSinceFire = new Map<number, number>();

export function listTimers(): TimerRow[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM timers ORDER BY name COLLATE NOCASE')
    .all() as TimerDbRow[];
  return rows.map(rowToTimer);
}

export function createTimer(input: TimerInput): TimerRow {
  const normalized = normalizeTimerInput(input);
  const info = getDatabase()
    .prepare(
      `INSERT INTO timers (name, message, interval_seconds, min_chat_lines, enabled)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      normalized.name,
      normalized.message,
      normalized.interval_seconds,
      normalized.min_chat_lines,
      normalized.enabled ? 1 : 0,
    );
  return getTimer(Number(info.lastInsertRowid));
}

export function updateTimer(update: TimerUpdate): TimerRow {
  const existing = getTimer(update.id);
  const normalized = normalizeTimerInput({
    name: update.name ?? existing.name,
    message: update.message ?? existing.message,
    interval_seconds: update.interval_seconds ?? existing.interval_seconds,
    min_chat_lines: update.min_chat_lines ?? existing.min_chat_lines,
    enabled: update.enabled ?? existing.enabled,
  });

  getDatabase()
    .prepare(
      `UPDATE timers
       SET name = ?, message = ?, interval_seconds = ?, min_chat_lines = ?,
           enabled = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .run(
      normalized.name,
      normalized.message,
      normalized.interval_seconds,
      normalized.min_chat_lines,
      normalized.enabled ? 1 : 0,
      update.id,
    );
  return getTimer(update.id);
}

export function deleteTimer(id: number): void {
  const info = getDatabase().prepare('DELETE FROM timers WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error(`Timer ${id} not found.`);
  chatLinesSinceFire.delete(id);
}

export function toggleTimer(id: number): TimerRow {
  const existing = getTimer(id);
  return updateTimer({ id, enabled: !existing.enabled });
}

export function startTimerEngine(): void {
  if (!unsubscribeChat) {
    unsubscribeChat = onBotEvent('chat_message', () => {
      const rows = getEnabledTimerIds();
      for (const id of rows) {
        chatLinesSinceFire.set(id, (chatLinesSinceFire.get(id) ?? 0) + 1);
      }
    });
  }
  if (timerLoop) return;
  timerLoop = setInterval(() => {
    void tickTimers().catch((err) => console.error('[timers] tick failed:', err));
  }, TICK_MS);
}

export function stopTimerEngine(): void {
  if (timerLoop) {
    clearInterval(timerLoop);
    timerLoop = null;
  }
  if (unsubscribeChat) {
    unsubscribeChat();
    unsubscribeChat = null;
  }
  chatLinesSinceFire.clear();
}

async function tickTimers(): Promise<void> {
  if (getBotState().state !== 'connected') return;

  const timers = getDatabase()
    .prepare('SELECT * FROM timers WHERE enabled = 1 ORDER BY id')
    .all() as TimerDbRow[];
  const now = Math.floor(Date.now() / 1000);

  for (const row of timers) {
    const timer = rowToTimer(row);
    if (!timer.message.trim()) continue;
    const last = timer.last_fired_at ?? 0;
    if (now - last < timer.interval_seconds) continue;
    const lines = chatLinesSinceFire.get(timer.id) ?? 0;
    if (lines < timer.min_chat_lines) continue;

    const message = await resolveTimerMessage(timer.message);
    if (!message.trim()) continue;

    await sendChat(
      message.length > MAX_CHAT_LENGTH
        ? `${message.slice(0, MAX_CHAT_LENGTH - 1)}...`
        : message,
    );
    getDatabase()
      .prepare('UPDATE timers SET last_fired_at = ?, updated_at = unixepoch() WHERE id = ?')
      .run(now, timer.id);
    chatLinesSinceFire.set(timer.id, 0);
  }
}

async function resolveTimerMessage(template: string): Promise<string> {
  const tokens = getCurrentTokens();
  if (!tokens) return template;
  const msg: ChatMessage = {
    id: null,
    channel: tokens.user.login,
    message: '',
    emotes: null,
    timestamp: new Date().toISOString(),
    user: {
      id: tokens.user.id,
      login: tokens.user.login,
      displayName: tokens.user.display_name,
      color: null,
      roles: {
        broadcaster: true,
        moderator: true,
        vip: false,
        subscriber: false,
      },
    },
  };
  const vars = await buildCommandVariables(msg);
  return interpolate(template, vars);
}

function getTimer(id: number): TimerRow {
  const row = getDatabase()
    .prepare('SELECT * FROM timers WHERE id = ?')
    .get(id) as TimerDbRow | undefined;
  if (!row) throw new Error(`Timer ${id} not found.`);
  return rowToTimer(row);
}

function getEnabledTimerIds(): number[] {
  const rows = getDatabase()
    .prepare('SELECT id FROM timers WHERE enabled = 1')
    .all() as { id: number }[];
  return rows.map((row) => row.id);
}

function normalizeTimerInput(input: TimerInput): Required<TimerInput> {
  const name = input.name.trim();
  if (!name) throw new Error('Timer name cannot be empty.');
  const message = input.message.trim();
  if (!message) throw new Error('Timer message cannot be empty.');

  const interval = input.interval_seconds ?? 300;
  if (!Number.isInteger(interval) || interval < 15) {
    throw new Error('Timer interval must be at least 15 seconds.');
  }

  const minChatLines = input.min_chat_lines ?? 0;
  if (!Number.isInteger(minChatLines) || minChatLines < 0) {
    throw new Error('Minimum chat lines must be a non-negative integer.');
  }

  return {
    name,
    message,
    interval_seconds: interval,
    min_chat_lines: minChatLines,
    enabled: input.enabled ?? true,
  };
}

function rowToTimer(row: TimerDbRow): TimerRow {
  return {
    ...row,
    enabled: row.enabled === 1,
  };
}
