import tmi from 'tmi.js';
import { broadcast } from '../ipc/broadcast';
import { handleChatMessage } from './command-engine';
import { handleMessageExp } from './exp-engine';
import {
  getCurrentSessionId,
  onStreamOffline,
  onStreamOnline,
} from './streak-tracker';
import { ensureValidToken, getCurrentTokens } from './twitch-auth';
import { connectEventSub, disconnectEventSub } from './twitch-eventsub';
import { getCurrentStream } from './twitch-helix';
import { onChatMessage as streakOnChatMessage } from './streak-tracker';

export type BotState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ChatMessage {
  user: {
    id: string;
    login: string;
    displayName: string;
    color: string | null;
    roles: {
      broadcaster: boolean;
      moderator: boolean;
      vip: boolean;
      subscriber: boolean;
    };
  };
  message: string;
  timestamp: string;
  channel: string;
}

export type ChatMessageHandler = (msg: ChatMessage) => void;

const MIN_SEND_INTERVAL_MS = 1000;
const MAX_QUEUE_DEPTH = 50;

let client: tmi.Client | null = null;
let state: BotState = 'disconnected';
let lastError: string | null = null;
const messageHandlers = new Set<ChatMessageHandler>();

const sendQueue: string[] = [];
let sendProcessing = false;

function setState(next: BotState, error?: string | null): void {
  state = next;
  lastError = error ?? null;
  broadcast('bot:status', { state, error: lastError });
}

export function getBotState(): { state: BotState; error: string | null } {
  return { state, error: lastError };
}

export function onChatMessage(handler: ChatMessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export async function connectBot(): Promise<void> {
  if (client || state === 'connecting' || state === 'connected') return;

  const tokens = await ensureValidToken();
  if (!tokens) {
    setState('error', 'Not signed in.');
    throw new Error('Not signed in.');
  }

  setState('connecting');

  const channel = tokens.user.login;
  client = new tmi.Client({
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: {
      username: channel,
      password: `oauth:${tokens.access_token}`,
    },
    channels: [channel],
  });

  client.on('connected', (addr, port) => {
    console.log(`[chat] connected to ${addr}:${port} as ${channel}`);
    setState('connected');
  });

  client.on('disconnected', (reason) => {
    console.log(`[chat] disconnected: ${reason ?? 'unknown'}`);
    if (state !== 'error') setState('disconnected', reason || null);
  });

  client.on('message', (chan, tags, text, self) => {
    if (self) return;
    const msg = normalizeMessage(chan, tags, text);
    console.log(`[chat] <${msg.user.displayName}> ${msg.message}`);
    broadcast('twitch:chat-message', msg);
    // EXP first: handleMessageExp upserts the users row. streakOnChatMessage
    // writes to viewer_sessions which has a FK to users.twitch_id, so running
    // it before the upsert loses a brand-new chatter's first message.
    try {
      handleMessageExp(msg);
    } catch (err) {
      console.error('[exp] message handler error:', err);
    }
    try {
      streakOnChatMessage(msg);
    } catch (err) {
      console.error('[session] chat presence error:', err);
    }
    void handleChatMessage(msg).catch((err) =>
      console.error('[cmd] handleChatMessage error:', err),
    );
    for (const handler of messageHandlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error('[chat] handler error:', err);
      }
    }
  });

  try {
    await client.connect();
    void connectEventSub().catch((err) =>
      console.error('[eventsub] connect failed:', err),
    );
    void probeStreamState(tokens.user.id).catch((err) =>
      console.error('[session] stream state probe failed:', err),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState('error', message);
    await safeDestroy();
    throw err;
  }
}

export async function disconnectBot(): Promise<void> {
  await disconnectEventSub();
  await safeDestroy();
  setState('disconnected');
}

/**
 * Enqueue a message for the bot to send. Rate-limited to MIN_SEND_INTERVAL_MS
 * between messages to stay well under Twitch's 20 msg/30s limit for regular
 * accounts. Oldest messages are dropped when the queue exceeds MAX_QUEUE_DEPTH.
 *
 * Resolves when the message is queued (not when it's been sent). Errors during
 * actual send are logged but don't propagate, so callers can fire-and-forget.
 */
export async function sendChat(text: string): Promise<void> {
  if (!client || state !== 'connected') {
    throw new Error('Bot is not connected.');
  }
  if (sendQueue.length >= MAX_QUEUE_DEPTH) {
    const dropped = sendQueue.shift();
    console.warn(`[chat] queue full, dropping oldest: ${dropped?.slice(0, 40)}…`);
  }
  sendQueue.push(text);
  if (!sendProcessing) void processSendQueue();
}

export function getChatQueueDepth(): number {
  return sendQueue.length;
}

async function processSendQueue(): Promise<void> {
  if (sendProcessing) return;
  sendProcessing = true;
  try {
    while (sendQueue.length > 0 && client && state === 'connected') {
      const tokens = getCurrentTokens();
      if (!tokens) break;
      const text = sendQueue.shift();
      if (text === undefined) break;
      try {
        await client.say(tokens.user.login, text);
      } catch (err) {
        console.error('[chat] send failed:', err);
      }
      if (sendQueue.length > 0) {
        await sleep(MIN_SEND_INTERVAL_MS);
      }
    }
  } finally {
    sendProcessing = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reconcile local session state with what Twitch says is happening. Called
 * after bot connect so we recover correctly from app restarts during a live
 * stream (the spec calls this out as a gap if we relied only on EventSub).
 */
async function probeStreamState(broadcasterId: string): Promise<void> {
  const stream = await getCurrentStream(broadcasterId);
  const haveLocalSession = getCurrentSessionId() !== null;

  if (stream && !haveLocalSession) {
    console.log(`[session] Helix reports live since ${stream.started_at} — resuming`);
    onStreamOnline(stream.started_at);
    broadcast('twitch:stream-online', { timestamp: stream.started_at });
  } else if (!stream && haveLocalSession) {
    console.log('[session] Helix reports offline — closing stale session');
    onStreamOffline();
    broadcast('twitch:stream-offline', { timestamp: new Date().toISOString() });
  }
}

async function safeDestroy(): Promise<void> {
  // Clear pending sends — they would error out anyway once disconnected.
  sendQueue.length = 0;
  if (!client) return;
  try {
    await client.disconnect();
  } catch {
    // ignore
  }
  client.removeAllListeners();
  client = null;
}

function normalizeMessage(
  channel: string,
  tags: tmi.ChatUserstate,
  text: string,
): ChatMessage {
  const badges = tags.badges ?? {};
  return {
    channel: channel.replace(/^#/, ''),
    message: text,
    timestamp: new Date().toISOString(),
    user: {
      id: tags['user-id'] ?? '',
      login: tags.username ?? '',
      displayName: tags['display-name'] || tags.username || 'anonymous',
      color: tags.color ?? null,
      roles: {
        broadcaster: Boolean(badges.broadcaster),
        moderator: Boolean(tags.mod) || Boolean(badges.moderator),
        vip: Boolean(badges.vip) || Boolean((tags as Record<string, unknown>).vip),
        subscriber: Boolean(tags.subscriber) || Boolean(badges.subscriber),
      },
    },
  };
}
