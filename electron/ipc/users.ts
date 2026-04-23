import { ipcMain } from 'electron';
import {
  adjustUserExp,
  getUserProfile,
  listUsers,
  resetUser,
  type ListUsersOptions,
} from '../services/users-repo';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerUserHandlers(): void {
  ipcMain.handle('users:list', (_e, opts?: ListUsersOptions) => {
    try {
      return ok(listUsers(opts ?? {}));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('users:get', (_e, twitchId: string) => {
    try {
      const profile = getUserProfile(twitchId);
      if (!profile) throw new Error(`User ${twitchId} not found.`);
      return ok(profile);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'users:update-exp',
    (_e, payload: { twitchId: string; delta: number; reason?: string }) => {
      try {
        const result = adjustUserExp(payload.twitchId, payload.delta, payload.reason);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle('users:reset', (_e, payload?: { twitchId?: string }) => {
    try {
      return ok(resetUser(payload?.twitchId ?? null));
    } catch (err) {
      return fail(err);
    }
  });
}
