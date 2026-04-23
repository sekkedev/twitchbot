import { create } from 'zustand';
import { invoke, on, tryInvoke } from '../lib/ipc';
import type { AuthStatus, BotStatus, SessionRow } from '../lib/types';

export interface Notice {
  tone: 'success' | 'info';
  message: string;
  id: number;
}

interface AppState {
  auth: AuthStatus;
  bot: BotStatus;
  session: SessionRow | null;
  devAvailable: boolean;
  error: string | null;
  notice: Notice | null;
  busy: boolean;

  init: () => () => void;
  refreshAuth: () => Promise<void>;
  refreshBot: () => Promise<void>;
  refreshSession: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  connectBot: () => Promise<void>;
  disconnectBot: () => Promise<void>;
  toggleFakeStream: () => Promise<void>;
  setError: (err: string | null) => void;
  showNotice: (tone: Notice['tone'], message: string, ttlMs?: number) => void;
  dismissNotice: () => void;
}

const defaultAuth: AuthStatus = { loggedIn: false, username: null, channel: null };
const defaultBot: BotStatus = { state: 'disconnected', error: null };

export const useAppStore = create<AppState>((set, get) => ({
  auth: defaultAuth,
  bot: defaultBot,
  session: null,
  devAvailable: false,
  error: null,
  notice: null,
  busy: false,

  init: () => {
    const offBot = on<BotStatus>('bot:status', (payload) => {
      set({ bot: payload });
    });
    const offSession = on<SessionRow | null>('sessions:current', (payload) => {
      set({ session: payload ?? null });
    });

    void get().refreshAuth();
    void get().refreshBot();
    void get().refreshSession();
    void tryInvoke<boolean>('dev:available').then((res) => {
      if (res.success) set({ devAvailable: Boolean(res.data) });
    });

    return () => {
      offBot();
      offSession();
    };
  },

  refreshAuth: async () => {
    const res = await tryInvoke<AuthStatus>('auth:status');
    if (res.success) set({ auth: res.data });
  },

  refreshBot: async () => {
    const res = await tryInvoke<BotStatus>('bot:state');
    if (res.success) set({ bot: res.data });
  },

  refreshSession: async () => {
    const res = await tryInvoke<SessionRow | null>('sessions:current');
    if (res.success) set({ session: res.data ?? null });
  },

  login: async () => {
    set({ busy: true, error: null });
    try {
      await invoke('auth:login');
      await get().refreshAuth();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed.' });
    } finally {
      set({ busy: false });
    }
  },

  logout: async () => {
    set({ busy: true, error: null });
    try {
      await invoke('auth:logout');
      await get().refreshAuth();
      await get().refreshBot();
      await get().refreshSession();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Logout failed.' });
    } finally {
      set({ busy: false });
    }
  },

  connectBot: async () => {
    set({ busy: true, error: null });
    try {
      await invoke('bot:connect');
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Bot connect failed.' });
    } finally {
      set({ busy: false });
    }
  },

  disconnectBot: async () => {
    set({ busy: true, error: null });
    try {
      await invoke('bot:disconnect');
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Bot disconnect failed.' });
    } finally {
      set({ busy: false });
    }
  },

  toggleFakeStream: async () => {
    set({ error: null });
    try {
      const channel = get().session ? 'dev:fake-stream-offline' : 'dev:fake-stream-online';
      await invoke(channel);
      await get().refreshSession();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Dev action failed.' });
    }
  },

  setError: (err) => set({ error: err }),

  showNotice: (tone, message, ttlMs = 4000) => {
    const id = Date.now();
    set({ notice: { tone, message, id } });
    window.setTimeout(() => {
      const current = get().notice;
      if (current && current.id === id) set({ notice: null });
    }, ttlMs);
  },

  dismissNotice: () => set({ notice: null }),
}));
