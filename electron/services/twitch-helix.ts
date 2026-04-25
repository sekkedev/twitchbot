import { ensureValidToken } from './twitch-auth';

const HELIX = 'https://api.twitch.tv/helix';

type HelixMethod = 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';

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
  } = {},
): Promise<T> {
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
    throw new Error(`Helix ${endpoint} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
