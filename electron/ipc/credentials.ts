import { ipcMain } from 'electron';
import {
  getCredentials,
  hasCredentials,
  saveCredentials,
  type Credentials,
} from '../services/credentials';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerCredentialHandlers(): void {
  ipcMain.handle('credentials:get', () => {
    try {
      return ok(getCredentials());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('credentials:has', () => ok(hasCredentials()));

  ipcMain.handle('credentials:set', (_event, payload: Credentials) => {
    try {
      saveCredentials(payload);
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });
}
