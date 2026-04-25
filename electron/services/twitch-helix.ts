import { ensureValidToken } from './twitch-auth';
import { broadcast } from '../ipc/broadcast';

const HELIX = 'https://api.twitch.tv/helix';

type HelixMethod = 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
type RateLimitKind = 'general' | 'mod-action';

interface RateQueueItem {
  kind: RateLimitKind;
  cost: number;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class HelixError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HelixError';
  }
}

export class HelixRateLimiter {
  private readonly pointsWindowMs = 60_000;
  private readonly maxPoints = 800;
  private readonly modWindowMs = 10_000;
  private readonly maxModActions = 30;
  private readonly maxPendingModActions = 50;
  private pointUsage: Array<{ timestamp: number; cost: number }> = [];
  private modActionUsage: number[] = [];
  private queue: RateQueueItem[] = [];
  private processTimer: NodeJS.Timeout | null = null;

  schedule(kind: RateLimitKind = 'general', cost = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      const item: RateQueueItem = { kind, cost, resolve, reject };
      if (this.canConsume(item, Date.now())) {
        this.consume(item, Date.now());
        resolve();
        return;
      }

      if (kind === 'mod-action') this.enforceModQueueLimit();
      this.queue.push(item);
      this.scheduleProcessing();
    });
  }

  private enforceModQueueLimit(): void {
    const pendingModActions = this.queue.filter((item) => item.kind === 'mod-action');
    if (pendingModActions.length < this.maxPendingModActions) return;
    const index = this.queue.findIndex((item) => item.kind === 'mod-action');
    if (index === -1) return;
    const [dropped] = this.queue.splice(index, 1);
    dropped?.reject(new Error('Helix moderation queue full; dropped oldest action.'));
    console.warn('[helix] moderation queue full, dropped oldest pending action');
  }

  private scheduleProcessing(): void {
    if (this.processTimer) return;
    this.processTimer = setInterval(() => this.processQueue(), 250);
  }

  private processQueue(): void {
    const now = Date.now();
    for (let i = 0; i < this.queue.length; ) {
      const item = this.queue[i]!;
      if (!this.canConsume(item, now)) {
        i += 1;
        continue;
      }
      this.queue.splice(i, 1);
      this.consume(item, now);
      item.resolve();
    }

    if (this.queue.length === 0 && this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
  }

  private canConsume(item: RateQueueItem, now: number): boolean {
    this.prune(now);
    const pointsUsed = this.pointUsage.reduce((sum, entry) => sum + entry.cost, 0);
    if (pointsUsed + item.cost > this.maxPoints) return false;
    if (
      item.kind === 'mod-action' &&
      this.modActionUsage.length >= this.maxModActions
    ) {
      return false;
    }
    return true;
  }

  private consume(item: RateQueueItem, now: number): void {
    this.prune(now);
    this.pointUsage.push({ timestamp: now, cost: item.cost });
    if (item.kind === 'mod-action') this.modActionUsage.push(now);
  }

  private prune(now: number): void {
    this.pointUsage = this.pointUsage.filter(
      (entry) => now - entry.timestamp < this.pointsWindowMs,
    );
    this.modActionUsage = this.modActionUsage.filter(
      (timestamp) => now - timestamp < this.modWindowMs,
    );
  }
}

const helixRateLimiter = new HelixRateLimiter();

export interface HelixStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  type: 'live' | '';
  title: string;
  viewer_count: number;
  started_at: string;
  tags?: string[];
}

export interface HelixFollower {
  user_id: string;
  user_login: string;
  user_name: string;
  followed_at: string;
}

export interface HelixPage<T> {
  data: T[];
  pagination?: { cursor?: string };
}

export async function helixRequest<T>(
  endpoint: string,
  options: {
    method?: HelixMethod;
    query?: Record<string, string | string[] | undefined>;
    body?: unknown;
    rateLimit?: RateLimitKind;
    cost?: number;
  } = {},
): Promise<T> {
  await helixRateLimiter.schedule(options.rateLimit ?? 'general', options.cost ?? 1);

  const tokens = await ensureValidToken();
  if (!tokens) throw new Error('Not signed in.');
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  if (!clientId) throw new Error('TWITCH_CLIENT_ID not set.');

  const url = new URL(`${HELIX}${endpoint}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access_token}`,
    'Client-Id': clientId,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      broadcast('auth:reauth-required', {
        reason: 'expired',
        endpoint,
      });
    }
    throw new HelixError(
      `Helix ${endpoint} failed: ${res.status} ${text}`,
      res.status,
      endpoint,
      text,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function deleteMessage(
  broadcasterId: string,
  moderatorId: string,
  messageId: string,
): Promise<void> {
  await helixRequest<void>('/moderation/chat', {
    method: 'DELETE',
    query: {
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
      message_id: messageId,
    },
    rateLimit: 'mod-action',
  });
}

export async function timeoutUser(
  broadcasterId: string,
  moderatorId: string,
  userId: string,
  duration: number,
  reason?: string,
): Promise<void> {
  await helixRequest<void>('/moderation/bans', {
    method: 'POST',
    query: {
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
    },
    body: {
      data: {
        user_id: userId,
        duration,
        reason: reason ?? '',
      },
    },
    rateLimit: 'mod-action',
  });
}

export async function banUser(
  broadcasterId: string,
  moderatorId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  await helixRequest<void>('/moderation/bans', {
    method: 'POST',
    query: {
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
    },
    body: {
      data: {
        user_id: userId,
        reason: reason ?? '',
      },
    },
    rateLimit: 'mod-action',
  });
}

async function helixGet<T>(
  endpoint: string,
  query?: Record<string, string | string[] | undefined>,
): Promise<T> {
  return helixRequest<T>(endpoint, { query });
}

/**
 * Fetch the current live stream for the authenticated broadcaster, or null if
 * they're not live. One-shot — no pagination.
 */
export async function getCurrentStream(broadcasterId: string): Promise<HelixStream | null> {
  const res = await helixGet<HelixPage<HelixStream>>('/streams', {
    user_id: broadcasterId,
  });
  return res.data[0] ?? null;
}

/**
 * Is `userId` a follower of `broadcasterId`?
 * Requires moderator:read:followers scope.
 */
export async function isUserFollowing(
  broadcasterId: string,
  userId: string,
): Promise<boolean> {
  const res = await helixGet<HelixPage<HelixFollower>>('/channels/followers', {
    broadcaster_id: broadcasterId,
    user_id: userId,
  });
  return res.data.length > 0;
}

/**
 * Stream all followers since a given date, in chronological order. The API
 * returns newest-first; we paginate and collect until we pass the threshold.
 */
export async function getFollowersSince(
  broadcasterId: string,
  since: Date,
): Promise<HelixFollower[]> {
  const collected: HelixFollower[] = [];
  let cursor: string | undefined;
  const sinceMs = since.getTime();

  while (true) {
    const page = await helixGet<HelixPage<HelixFollower>>('/channels/followers', {
      broadcaster_id: broadcasterId,
      first: '100',
      after: cursor,
    });
    let passedThreshold = false;
    for (const f of page.data) {
      if (new Date(f.followed_at).getTime() <= sinceMs) {
        passedThreshold = true;
        break;
      }
      collected.push(f);
    }
    if (passedThreshold) break;
    if (!page.pagination?.cursor) break;
    cursor = page.pagination.cursor;
    if (collected.length > 500) break; // safety bound
  }

  // Return chronological (oldest first) for deterministic processing
  return collected.reverse();
}
