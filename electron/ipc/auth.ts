import { ipcMain } from 'electron';
import {
  getAuthStatus,
  logout,
  startLoginFlow,
} from '../services/twitch-auth';
import { disconnectBot } from '../services/twitch-chat';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function fail(err: unknown): IpcResult<never> {
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: message };
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:login', async () => {
    try {
      const tokens = await startLoginFlow();
      return ok({
        username: tokens.user.display_name,
        channel: tokens.user.login,
        scopes: tokens.scopes,
      });
    } catch (err) {
      console.error('[auth:login]', err);
      return fail(err);
    }
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      await disconnectBot();
      await logout();
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('auth:status', () => {
    try {
      return ok(getAuthStatus());
    } catch (err) {
      return fail(err);
    }
  });
}
