/**
 * In-memory ring buffer of recent feed-relevant broadcasts. Used to seed
 * newly-mounted renderer views (new popouts, post-reload) so the Live feed
 * doesn't start blank.
 *
 * Not persisted — on app restart the buffer starts empty and fills as events
 * arrive.
 */

export interface FeedBufferEntry {
  channel: string;
  payload: unknown;
  at: number;
}

const MAX_SIZE = 150;

const FEED_CHANNELS = new Set<string>([
  'twitch:chat-message',
  'twitch:follow',
  'twitch:subscribe',
  'twitch:gift-sub',
  'twitch:cheer',
  'twitch:raid',
  'twitch:stream-online',
  'twitch:stream-offline',
  'commands:executed',
  'users:exp-gained',
]);

const buffer: FeedBufferEntry[] = [];

export function isFeedChannel(channel: string): boolean {
  return FEED_CHANNELS.has(channel);
}

export function recordFeedEvent(channel: string, payload: unknown): void {
  if (!FEED_CHANNELS.has(channel)) return;
  buffer.push({ channel, payload, at: Date.now() });
  if (buffer.length > MAX_SIZE) buffer.shift();
}

export function getFeedSnapshot(): FeedBufferEntry[] {
  return buffer.slice();
}

export function clearFeedBuffer(): void {
  buffer.length = 0;
}
