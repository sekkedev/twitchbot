import { getCurrentTokens } from './twitch-auth';
import { isUserFollowing } from './twitch-helix';

const TTL_MS = 15 * 60 * 1000;

interface Entry {
  isFollower: boolean;
  fetchedAt: number;
  /** In-flight promise so concurrent callers share one Helix call. */
  pending?: Promise<boolean>;
}

const cache = new Map<string, Entry>();

/**
 * Returns whether `userId` follows the authenticated broadcaster, with a
 * 15-minute TTL. First check for a given user hits Helix; subsequent checks
 * are instant until the entry expires.
 *
 * NOTE: Twitch EventSub does not expose `channel.unfollow`, so the cache can
 * show a user as still-following for up to TTL_MS after they unfollow. This
 * is an acceptable tradeoff — the alternative is a Helix round-trip per
 * command invocation.
 */
export async function isFollower(userId: string): Promise<boolean> {
  const tokens = getCurrentTokens();
  if (!tokens) return false;
  const now = Date.now();

  const existing = cache.get(userId);
  if (existing) {
    if (existing.pending) return existing.pending;
    if (now - existing.fetchedAt < TTL_MS) return existing.isFollower;
  }

  const promise = (async () => {
    try {
      const result = await isUserFollowing(tokens.user.id, userId);
      cache.set(userId, { isFollower: result, fetchedAt: Date.now() });
      return result;
    } catch (err) {
      console.error('[follower-cache] lookup failed:', err);
      // Cache a short negative so a failing endpoint doesn't hammer Helix.
      cache.set(userId, { isFollower: false, fetchedAt: Date.now() });
      return false;
    }
  })();

  cache.set(userId, {
    isFollower: existing?.isFollower ?? false,
    fetchedAt: existing?.fetchedAt ?? 0,
    pending: promise,
  });

  return promise;
}

/**
 * Warm the cache with a known-positive entry. Called when we see a new
 * `channel.follow` EventSub notification — no need for the next command
 * invocation from that user to trigger a Helix lookup.
 */
export function markFollowing(userId: string): void {
  cache.set(userId, { isFollower: true, fetchedAt: Date.now() });
}

/** Invalidate one user's cache entry. */
export function invalidate(userId: string): void {
  cache.delete(userId);
}

/** Drop everything — used on logout. */
export function clearCache(): void {
  cache.clear();
}
