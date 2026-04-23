import { useEffect, useState } from 'react';
import { on, tryInvoke } from '../lib/ipc';
import type { ChatMessagePayload } from '../lib/types';

interface EventUser {
  id: string;
  login: string;
  displayName: string;
}

export type FeedItem =
  | { kind: 'chat'; at: string; msg: ChatMessagePayload }
  | { kind: 'follow'; at: string; user: EventUser }
  | {
      kind: 'subscribe';
      at: string;
      user: EventUser;
      tier: string;
      months: number;
      isGift: boolean;
      message?: string | null;
    }
  | {
      kind: 'gift-sub';
      at: string;
      user: EventUser | null;
      total: number;
      tier: string;
      isAnonymous: boolean;
    }
  | {
      kind: 'cheer';
      at: string;
      user: EventUser | null;
      bits: number;
      message: string;
    }
  | {
      kind: 'raid';
      at: string;
      fromChannel: string;
      fromDisplayName: string;
      viewers: number;
    }
  | { kind: 'stream-online'; at: string }
  | { kind: 'stream-offline'; at: string }
  | {
      kind: 'exp';
      at: string;
      user: EventUser;
      amount: number;
      source: string;
      newTotal: number;
      newLevel: number;
    }
  | { kind: 'command'; at: string; user: string; command: string };

type FeedEntry = FeedItem & { key: string; expGained?: number };

interface ExpGainedPayload {
  user: EventUser;
  amount: number;
  source: string;
  newTotal: number;
  newLevel: number;
}

interface FeedBufferEntry {
  channel: string;
  payload: unknown;
  at: number;
}

const TIER_LABEL: Record<string, string> = {
  '1000': 'Tier 1',
  '2000': 'Tier 2',
  '3000': 'Tier 3',
  prime: 'Prime',
};

const tierName = (tier: string): string =>
  TIER_LABEL[tier.toLowerCase()] ?? TIER_LABEL[tier] ?? tier;

let feedSeq = 0;
const nextKey = () => `${Date.now()}-${++feedSeq}`;

function attachMatcher(source: string, login: string) {
  const lower = login.toLowerCase();
  return (item: FeedEntry): boolean => {
    switch (source) {
      case 'message':
        return item.kind === 'chat' && item.msg.user.login.toLowerCase() === lower;
      case 'follow':
        return item.kind === 'follow' && item.user.login.toLowerCase() === lower;
      case 'subscribe':
        return item.kind === 'subscribe' && item.user.login.toLowerCase() === lower;
      case 'gift_sub':
        return (
          item.kind === 'gift-sub' &&
          (item.user?.login.toLowerCase() ?? '') === lower
        );
      case 'cheer':
        return (
          item.kind === 'cheer' && (item.user?.login.toLowerCase() ?? '') === lower
        );
      case 'raid':
        return item.kind === 'raid';
      default:
        return false;
    }
  };
}

/**
 * Pure conversion from raw broadcast payload to a FeedItem (excluding EXP
 * gains, which modify existing items rather than creating new ones). Used by
 * live subscribers AND by the snapshot seeder so both paths produce the same
 * shape.
 */
function payloadToFeedItem(channel: string, payload: unknown): FeedItem | null {
  switch (channel) {
    case 'twitch:chat-message': {
      const msg = payload as ChatMessagePayload;
      return { kind: 'chat', at: msg.timestamp, msg };
    }
    case 'twitch:follow': {
      const p = payload as { user: EventUser; timestamp: string };
      return { kind: 'follow', at: p.timestamp, user: p.user };
    }
    case 'twitch:subscribe': {
      const p = payload as {
        user: EventUser;
        tier: string;
        months: number;
        isGift: boolean;
        message?: string | null;
        timestamp: string;
      };
      return {
        kind: 'subscribe',
        at: p.timestamp,
        user: p.user,
        tier: p.tier,
        months: p.months,
        isGift: p.isGift,
        message: p.message,
      };
    }
    case 'twitch:gift-sub': {
      const p = payload as {
        user: EventUser | null;
        total: number;
        tier: string;
        isAnonymous: boolean;
        timestamp: string;
      };
      return {
        kind: 'gift-sub',
        at: p.timestamp,
        user: p.user,
        total: p.total,
        tier: p.tier,
        isAnonymous: p.isAnonymous,
      };
    }
    case 'twitch:cheer': {
      const p = payload as {
        user: EventUser | null;
        bits: number;
        message: string;
        timestamp: string;
      };
      return {
        kind: 'cheer',
        at: p.timestamp,
        user: p.user,
        bits: p.bits,
        message: p.message,
      };
    }
    case 'twitch:raid': {
      const p = payload as {
        fromChannel: string;
        fromDisplayName: string;
        viewers: number;
        timestamp: string;
      };
      return {
        kind: 'raid',
        at: p.timestamp,
        fromChannel: p.fromChannel,
        fromDisplayName: p.fromDisplayName,
        viewers: p.viewers,
      };
    }
    case 'twitch:stream-online': {
      const p = payload as { timestamp: string };
      return { kind: 'stream-online', at: p.timestamp };
    }
    case 'twitch:stream-offline': {
      const p = payload as { timestamp: string };
      return { kind: 'stream-offline', at: p.timestamp };
    }
    case 'commands:executed': {
      const p = payload as {
        command: string;
        kind: string;
        user: string;
        timestamp: string;
      };
      return { kind: 'command', at: p.timestamp, user: p.user, command: p.command };
    }
    default:
      return null;
  }
}

/**
 * Apply an EXP-gained payload to an existing feed array. Attaches to a recent
 * matching source row when possible, otherwise pushes a standalone entry.
 * Skips watch_time silently — it'd spam one row per minute per viewer.
 */
function applyExpGained(
  prev: FeedEntry[],
  payload: ExpGainedPayload,
  limit: number,
): FeedEntry[] {
  if (payload.source === 'watch_time') return prev;
  const match = attachMatcher(payload.source, payload.user.login);
  const idx = prev.slice(0, 10).findIndex(match);
  if (idx !== -1) {
    const next = [...prev];
    next[idx] = {
      ...next[idx],
      expGained: (next[idx].expGained ?? 0) + payload.amount,
    };
    return next;
  }
  const item: FeedEntry = {
    key: nextKey(),
    kind: 'exp',
    at: new Date().toISOString(),
    user: payload.user,
    amount: payload.amount,
    source: payload.source,
    newTotal: payload.newTotal,
    newLevel: payload.newLevel,
  };
  return [item, ...prev].slice(0, limit);
}

export function useLiveFeed(limit = 100): FeedEntry[] {
  const [feed, setFeed] = useState<FeedEntry[]>([]);

  useEffect(() => {
    const push = (item: FeedItem) =>
      setFeed((prev) => [{ ...item, key: nextKey() }, ...prev].slice(0, limit));

    const liveChannels = [
      'twitch:chat-message',
      'twitch:follow',
      'twitch:subscribe',
      'twitch:gift-sub',
      'twitch:cheer',
      'twitch:raid',
      'twitch:stream-online',
      'twitch:stream-offline',
      'commands:executed',
    ];

    const offs: Array<() => void> = [];
    for (const channel of liveChannels) {
      offs.push(
        on(channel, (payload) => {
          const item = payloadToFeedItem(channel, payload);
          if (item) push(item);
        }),
      );
    }
    offs.push(
      on<ExpGainedPayload>('users:exp-gained', (payload) => {
        setFeed((prev) => applyExpGained(prev, payload, limit));
      }),
    );

    // Seed from the main-process ring buffer so newly-opened windows show
    // recent history instead of a blank feed.
    void tryInvoke<FeedBufferEntry[]>('feed:snapshot').then((res) => {
      if (!res.success) return;
      setFeed((prev) => {
        // Replay buffer chronologically; chat/event items append to the back
        // (they're older than any live items that may have arrived during the
        // round-trip), EXP gains apply against whatever exists at that point.
        const seenAt = new Set(prev.map((e) => `${e.kind}-${e.at}`));
        let next = prev.slice();
        for (const entry of res.data) {
          if (entry.channel === 'users:exp-gained') {
            next = applyExpGained(
              next,
              entry.payload as ExpGainedPayload,
              limit,
            );
            continue;
          }
          const item = payloadToFeedItem(entry.channel, entry.payload);
          if (!item) continue;
          const dedupe = `${item.kind}-${item.at}`;
          if (seenAt.has(dedupe)) continue;
          seenAt.add(dedupe);
          next.push({ ...item, key: nextKey() });
        }
        return next.slice(0, limit);
      });
    });

    return () => {
      for (const off of offs) off();
    };
  }, [limit]);

  return feed;
}

function ExpBadge({ amount }: { amount: number }) {
  return (
    <span
      className="shrink-0 font-mono text-[10px] text-accent/80"
      title={`+${amount} EXP`}
    >
      +{amount}
    </span>
  );
}

export function LiveFeed({ feed }: { feed: FeedEntry[] }) {
  if (feed.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-dim">
        Waiting for activity…
      </div>
    );
  }
  return (
    <ul>
      {feed.map((item, idx) => (
        <FeedRow key={item.key} item={item} prev={feed[idx - 1]} />
      ))}
    </ul>
  );
}

function FeedRow({
  item,
  prev,
}: {
  item: FeedEntry;
  prev?: FeedEntry;
}) {
  const time = new Date(item.at).toLocaleTimeString();

  if (item.kind === 'chat') {
    const grouped = prev?.kind === 'chat' && prev.msg.user.login === item.msg.user.login;
    return (
      <li
        className={`flex gap-3 px-4 text-sm ${
          grouped
            ? 'pt-0.5 pb-0.5'
            : 'pt-2 pb-1 border-t border-border first:border-t-0'
        }`}
      >
        {grouped ? (
          <span className="w-[72px] shrink-0" aria-hidden />
        ) : (
          <span className="w-[72px] shrink-0 font-mono text-xs text-text-dim">
            {time}
          </span>
        )}
        {grouped ? (
          <span className="w-[110px] shrink-0" aria-hidden />
        ) : (
          <span
            className="w-[110px] shrink-0 truncate font-semibold"
            style={{ color: item.msg.user.color ?? '#a78bfa' }}
            title={item.msg.user.displayName}
          >
            {item.msg.user.displayName}
          </span>
        )}
        <span className="min-w-0 flex-1 break-words text-text">{item.msg.message}</span>
        {item.expGained ? <ExpBadge amount={item.expGained} /> : null}
      </li>
    );
  }

  const { label, tone, body } = describeEvent(item);
  return (
    <li className="flex gap-3 border-t border-border px-4 py-1.5 text-sm first:border-t-0">
      <span className="w-[72px] shrink-0 font-mono text-xs text-text-dim">{time}</span>
      <span
        className={`w-[110px] shrink-0 font-mono text-[10px] uppercase tracking-wider ${tone}`}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words text-text">{body}</span>
      {item.expGained ? <ExpBadge amount={item.expGained} /> : null}
    </li>
  );
}

function describeEvent(item: FeedItem): {
  label: string;
  tone: string;
  body: React.ReactNode;
} {
  switch (item.kind) {
    case 'follow':
      return {
        label: 'follow',
        tone: 'text-live',
        body: (
          <>
            <span className="font-semibold">{item.user.displayName}</span>
            <span className="text-text-muted"> followed</span>
          </>
        ),
      };
    case 'subscribe':
      return {
        label: item.isGift ? 'gift recv' : item.months > 1 ? 'resub' : 'sub',
        tone: 'text-accent',
        body: (
          <>
            <span className="font-semibold">{item.user.displayName}</span>
            <span className="text-text-muted">
              {' '}
              {item.isGift ? 'received a gift' : 'subscribed'} ({tierName(item.tier)}
              {item.months > 1 ? `, ${item.months}mo` : ''})
            </span>
            {item.message ? (
              <span className="ml-2 text-text">“{item.message}”</span>
            ) : null}
          </>
        ),
      };
    case 'gift-sub':
      return {
        label: 'gift subs',
        tone: 'text-accent',
        body: (
          <>
            <span className="font-semibold">
              {item.isAnonymous || !item.user ? 'Anonymous' : item.user.displayName}
            </span>
            <span className="text-text-muted">
              {' '}
              gifted {item.total} {tierName(item.tier)} sub{item.total === 1 ? '' : 's'}
            </span>
          </>
        ),
      };
    case 'cheer':
      return {
        label: 'cheer',
        tone: 'text-pending',
        body: (
          <>
            <span className="font-semibold">{item.user?.displayName ?? 'Anonymous'}</span>
            <span className="text-text-muted">
              {' '}
              cheered <span className="font-mono text-pending">{item.bits} bits</span>
            </span>
            {item.message ? <span className="ml-2 text-text">{item.message}</span> : null}
          </>
        ),
      };
    case 'raid':
      return {
        label: 'raid',
        tone: 'text-accent',
        body: (
          <>
            <span className="font-semibold">{item.fromDisplayName}</span>
            <span className="text-text-muted"> raided with </span>
            <span className="font-mono text-text">{item.viewers}</span>
            <span className="text-text-muted"> viewer{item.viewers === 1 ? '' : 's'}</span>
          </>
        ),
      };
    case 'stream-online':
      return {
        label: 'stream',
        tone: 'text-live',
        body: <span className="text-text-muted">Stream went live</span>,
      };
    case 'stream-offline':
      return {
        label: 'stream',
        tone: 'text-offline',
        body: <span className="text-text-muted">Stream ended</span>,
      };
    case 'command':
      return {
        label: 'command',
        tone: 'text-text-dim',
        body: (
          <>
            <span className="font-semibold">{item.user}</span>
            <span className="text-text-muted"> ran </span>
            <span className="font-mono text-text">!{item.command}</span>
          </>
        ),
      };
    case 'exp':
      return {
        label: 'exp',
        tone: 'text-text-dim',
        body: (
          <>
            <span className="font-semibold">{item.user.displayName}</span>
            <span className="text-text-muted"> earned </span>
            <span className="font-mono text-accent">+{item.amount}</span>
            <span className="text-text-muted"> EXP ({item.source})</span>
            <span className="text-text-dim">
              {' '}
              · lvl <span className="font-mono text-text">{item.newLevel}</span> ·{' '}
              <span className="font-mono">{item.newTotal}</span> total
            </span>
          </>
        ),
      };
    default:
      return { label: '', tone: 'text-text-dim', body: null };
  }
}
