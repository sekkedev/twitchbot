import { ipcMain } from 'electron';
import {
  getCurrentSessionRow,
  listSessionHistory,
} from '../services/streak-tracker';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerSessionHandlers(): void {
  ipcMain.handle('sessions:current', () => {
    try {
      return ok(getCurrentSessionRow());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('sessions:history', (_event, limit?: number) => {
    try {
      return ok(listSessionHistory(typeof limit === 'number' ? limit : 50));
    } catch (err) {
      return fail(err);
    }
  });
}
