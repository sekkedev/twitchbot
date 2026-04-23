import { ipcMain } from 'electron';
import { getAllSettings, updateSetting } from '../services/settings-service';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get-all', () => {
    try {
      return ok(getAllSettings());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'settings:update',
    (_e, payload: { key: string; value: unknown }) => {
      try {
        updateSetting(payload.key, payload.value);
        return ok({ key: payload.key, value: String(payload.value) });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
