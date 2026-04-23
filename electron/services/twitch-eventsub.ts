import WebSocket from 'ws';
import { broadcast } from '../ipc/broadcast';
import {
  handleCheerExp,
  handleFollowExp,
  handleGiftSubExp,
  handleRaidExp,
  handleSubscribeExp,
} from './exp-engine';
import { markFollowing } from './follower-cache';
import { onStreamOffline, onStreamOnline } from './streak-tracker';
import { ensureValidToken } from './twitch-auth';
import { getFollowersSince } from './twitch-helix';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HELIX = 'https://api.twitch.tv/helix';
const RECONNECT_DELAY_MS = 3000;

export type EventSubState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface SubSpec {
  type: string;
  version: string;
  condition: Record<string, string>;
}

interface EventSubMessage {
  metadata: { message_type: string };
  payload: {
    session?: { id: string; reconnect_url?: string | null };
    subscription?: { type: string };
    event?: Record<string, unknown>;
  };
}

const BACKFILL_THRESHOLD_MS = 30_000;

let ws: WebSocket | null = null;
let state: EventSubState = 'disconnected';
let wantConnected = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let disconnectedAt: number | null = null;
const subscribedSessionIds = new Set<string>();

export function getEventSubState(): EventSubState {
  return state;
}

export async function connectEventSub(): Promise<void> {
  wantConnected = true;
  if (ws || state === 'connecting' || state === 'connected') return;
  openSocket(EVENTSUB_URL);
}

export async function disconnectEventSub(): Promise<void> {
  wantConnected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  subscribedSessionIds.clear();
  state = 'disconnected';
}

function openSocket(url: string): void {
  state = 'connecting';
  const socket = new WebSocket(url);
  ws = socket;

  socket.on('open', () => {
    console.log('[eventsub] ws open');
  });

  socket.on('message', (data: WebSocket.RawData) => {
    void handleMessage(data.toString('utf8'));
  });

  socket.on('close', (code, reason) => {
    if (ws !== socket) return; // a replacement socket took over (reconnect flow)
    console.log(`[eventsub] ws closed code=${code} reason=${reason.toString() || 'n/a'}`);
    ws = null;
    if (wantConnected) {
      state = 'connecting';
      if (disconnectedAt === null) disconnectedAt = Date.now();
      scheduleReconnect();
    } else {
      state = 'disconnected';
      disconnectedAt = null;
    }
  });

  socket.on('error', (err) => {
    console.error('[eventsub] ws error', err.message);
    state = 'error';
  });
}

function scheduleReconnect(): void {
  if (!wantConnected || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wantConnected && !ws) openSocket(EVENTSUB_URL);
  }, RECONNECT_DELAY_MS);
}

async function handleMessage(raw: string): Promise<void> {
  let payload: EventSubMessage;
  try {
    payload = JSON.parse(raw) as EventSubMessage;
  } catch (err) {
    console.error('[eventsub] bad payload', err);
    return;
  }

  const type = payload.metadata?.message_type;
  switch (type) {
    case 'session_welcome': {
      const session = payload.payload.session;
      if (!session) return;
      state = 'connected';
      const wasDisconnectedSince = disconnectedAt;
      disconnectedAt = null;
      if (!subscribedSessionIds.has(session.id)) {
        subscribedSessionIds.add(session.id);
        try {
          await subscribeAll(session.id);
        } catch (err) {
          console.error('[eventsub] subscribe failed:', err);
        }
      }
      if (
        wasDisconnectedSince !== null &&
        Date.now() - wasDisconnectedSince > BACKFILL_THRESHOLD_MS
      ) {
        void backfillFollowers(new Date(wasDisconnectedSince)).catch((err) =>
          console.error('[eventsub] follower backfill failed:', err),
        );
      }
      break;
    }
    case 'session_keepalive':
      break;
    case 'session_reconnect': {
      const url = payload.payload.session?.reconnect_url;
      if (!url) return;
      console.log('[eventsub] server requested reconnect');
      const old = ws;
      openSocket(url);
      if (old) {
        try {
          old.close();
        } catch {
          // ignore
        }
      }
      break;
    }
    case 'notification':
      handleNotification(payload.payload);
      break;
    case 'revocation':
      console.warn('[eventsub] subscription revoked:', payload.payload);
      break;
    default:
      break;
  }
}

function buildSubscriptions(broadcasterId: string): SubSpec[] {
  return [
    {
      type: 'channel.follow',
      version: '2',
      condition: {
        broadcaster_user_id: broadcasterId,
        moderator_user_id: broadcasterId,
      },
    },
    {
      type: 'channel.subscribe',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
    },
    {
      type: 'channel.subscription.gift',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
    },
    {
      type: 'channel.subscription.message',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
    },
    {
      type: 'channel.cheer',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
    },
    {
      type: 'channel.raid',
      version: '1',
      condition: { to_broadcaster_user_id: broadcasterId },
    },
    {
      type: 'stream.online',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
    },
    {
      type: 'stream.offline',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
    },
  ];
}

async function subscribeAll(sid: string): Promise<void> {
  const tokens = await ensureValidToken();
  if (!tokens) throw new Error('No valid token for EventSub subscriptions.');
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  if (!clientId) throw new Error('TWITCH_CLIENT_ID not set.');

  const subs = buildSubscriptions(tokens.user.id);
  for (const sub of subs) {
    try {
      const res = await fetch(`${HELIX}/eventsub/subscriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Client-Id': clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: sub.type,
          version: sub.version,
          condition: sub.condition,
          transport: { method: 'websocket', session_id: sid },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[eventsub] ${sub.type} subscribe failed: ${res.status} ${text}`);
      } else {
        console.log(`[eventsub] subscribed to ${sub.type}`);
      }
    } catch (err) {
      console.warn(`[eventsub] ${sub.type} error`, err);
    }
  }
}

function safeExp(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error('[exp] event handler error:', err);
  }
}

async function backfillFollowers(since: Date): Promise<void> {
  const tokens = await ensureValidToken();
  if (!tokens) return;
  console.log(`[eventsub] backfilling followers since ${since.toISOString()}`);
  const followers = await getFollowersSince(tokens.user.id, since);
  if (followers.length === 0) {
    console.log('[eventsub] no missed followers');
    return;
  }
  for (const f of followers) {
    safeExp(() => {
      handleFollowExp(f.user_id, f.user_name || f.user_login, { backfilled: true });
      markFollowing(f.user_id);
    });
  }
  console.log(`[eventsub] backfilled ${followers.length} follower(s)`);
}

function handleNotification(data: EventSubMessage['payload']): void {
  const subType = data.subscription?.type;
  const event = data.event as Record<string, unknown> | undefined;
  if (!subType || !event) return;
  const now = new Date().toISOString();

  const userFromEvent = () => ({
    id: String(event.user_id ?? ''),
    login: String(event.user_login ?? ''),
    displayName: String(event.user_name ?? event.user_login ?? 'anonymous'),
  });

  switch (subType) {
    case 'channel.follow': {
      const user = userFromEvent();
      broadcast('twitch:follow', {
        user,
        timestamp: (event.followed_at as string) ?? now,
      });
      safeExp(() => {
        handleFollowExp(user.id, user.displayName);
        markFollowing(user.id);
      });
      break;
    }
    case 'channel.subscribe': {
      const user = userFromEvent();
      const tier = String(event.tier ?? '1000');
      const isGift = Boolean(event.is_gift);
      broadcast('twitch:subscribe', {
        user,
        tier,
        months: 1,
        isGift,
        timestamp: now,
      });
      safeExp(() => handleSubscribeExp(user.id, user.displayName, tier, 1, isGift));
      break;
    }
    case 'channel.subscription.message': {
      const user = userFromEvent();
      const tier = String(event.tier ?? '1000');
      const months = Number(event.cumulative_months ?? 1);
      const message = event.message as { text?: string } | undefined;
      broadcast('twitch:subscribe', {
        user,
        tier,
        months,
        isGift: false,
        message: message?.text ?? null,
        timestamp: now,
      });
      safeExp(() => handleSubscribeExp(user.id, user.displayName, tier, months, false));
      break;
    }
    case 'channel.subscription.gift': {
      const isAnonymous = Boolean(event.is_anonymous);
      const user = isAnonymous ? null : userFromEvent();
      const total = Number(event.total ?? 1);
      const tier = String(event.tier ?? '1000');
      broadcast('twitch:gift-sub', {
        user,
        total,
        tier,
        isAnonymous,
        timestamp: now,
      });
      safeExp(() =>
        handleGiftSubExp(
          user?.id ?? null,
          user?.displayName ?? null,
          total,
          tier,
          isAnonymous,
        ),
      );
      break;
    }
    case 'channel.cheer': {
      const isAnonymous = Boolean(event.is_anonymous);
      const user = isAnonymous ? null : userFromEvent();
      const bits = Number(event.bits ?? 0);
      broadcast('twitch:cheer', {
        user,
        bits,
        message: String(event.message ?? ''),
        timestamp: now,
      });
      safeExp(() =>
        handleCheerExp(user?.id ?? null, user?.displayName ?? null, bits, isAnonymous),
      );
      break;
    }
    case 'channel.raid': {
      const fromChannel = String(event.from_broadcaster_user_login ?? '');
      const viewers = Number(event.viewers ?? 0);
      broadcast('twitch:raid', {
        fromChannel,
        fromDisplayName: String(
          event.from_broadcaster_user_name ?? event.from_broadcaster_user_login ?? '',
        ),
        viewers,
        timestamp: now,
      });
      safeExp(() => handleRaidExp(viewers, fromChannel));
      break;
    }
    case 'stream.online':
      broadcast('twitch:stream-online', {
        timestamp: (event.started_at as string) ?? now,
      });
      safeExp(onStreamOnline);
      break;
    case 'stream.offline':
      broadcast('twitch:stream-offline', { timestamp: now });
      safeExp(onStreamOffline);
      break;
    default:
      break;
  }
}
