import { ipcMain } from 'electron';
import { broadcast } from './broadcast';
import { onStreamOffline, onStreamOnline } from '../services/streak-tracker';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerDevHandlers(): void {
  const isDev = process.env.NODE_ENV === 'development';

  ipcMain.handle('dev:available', () => ok(isDev));

  if (!isDev) return;

  ipcMain.handle('dev:fake-stream-online', () => {
    try {
      onStreamOnline();
      broadcast('twitch:stream-online', { timestamp: new Date().toISOString() });
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('dev:fake-stream-offline', () => {
    try {
      onStreamOffline();
      broadcast('twitch:stream-offline', { timestamp: new Date().toISOString() });
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });
}
