import { ipcMain } from 'electron';
import { getActivity, getOverview, type ActivityRange } from '../services/analytics-service';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerAnalyticsHandlers(): void {
  ipcMain.handle('analytics:overview', () => {
    try {
      return ok(getOverview());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('analytics:activity', (_e, range?: ActivityRange) => {
    try {
      return ok(getActivity(range ?? 'week'));
    } catch (err) {
      return fail(err);
    }
  });
}
