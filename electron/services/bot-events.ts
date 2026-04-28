import { EventEmitter } from 'node:events';
import type { ChatMessage } from './twitch-chat';

export interface BotEventUser {
  id: string;
  login: string;
  displayName: string;
}

export interface BotEventMap {
  chat_message: ChatMessage;
  follow: {
    user: BotEventUser;
    timestamp: string;
  };
  subscription: {
    user: BotEventUser;
    tier: string;
    months: number;
    isGift: boolean;
    message?: string | null;
    timestamp: string;
  };
  sub_gift: {
    user: BotEventUser | null;
    total: number;
    tier: string;
    isAnonymous: boolean;
    timestamp: string;
  };
  cheer: {
    user: BotEventUser | null;
    bits: number;
    message: string;
    timestamp: string;
  };
  raid: {
    fromChannel: string;
    fromDisplayName: string;
    viewers: number;
    timestamp: string;
  };
  stream_online: {
    timestamp: string;
  };
  stream_offline: {
    timestamp: string;
  };
}

type BotEventName = keyof BotEventMap;
type BotEventHandler<K extends BotEventName> = (payload: BotEventMap[K]) => void;

const emitter = new EventEmitter();

export function emitBotEvent<K extends BotEventName>(
  event: K,
  payload: BotEventMap[K],
): void {
  for (const listener of emitter.listeners(event)) {
    try {
      (listener as BotEventHandler<K>)(payload);
    } catch (err) {
      console.error(`[bot-events] ${String(event)} listener failed:`, err);
    }
  }
}

export function onBotEvent<K extends BotEventName>(
  event: K,
  handler: BotEventHandler<K>,
): () => void {
  const wrapped = handler as (...args: unknown[]) => void;
  emitter.on(event, wrapped);
  return () => emitter.off(event, wrapped);
}
