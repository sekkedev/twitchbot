import { ipcMain } from 'electron';
import {
  addPermittedUser,
  clearWarnings,
  getModSettings,
  getModStatus,
  listPermittedUsers,
  listWarnings,
  removePermittedUser,
  updateModSettings,
  type ModWarningFilters,
} from '../services/moderation-service';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerModerationHandlers(): void {
  ipcMain.handle('mod:getSettings', () => {
    try {
      return ok(getModSettings());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mod:updateSettings', (_event, updates: Record<string, unknown>) => {
    try {
      return ok(updateModSettings(updates));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mod:getWarnings', (_event, filters?: ModWarningFilters) => {
    try {
      return ok(listWarnings(filters));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mod:clearWarnings', (_event, payload?: { user_id?: string }) => {
    try {
      return ok(clearWarnings(payload?.user_id));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'mod:addPermittedUser',
    (_event, payload: { user_id: string; username: string }) => {
      try {
        return ok(addPermittedUser(payload.user_id, payload.username));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle('mod:removePermittedUser', (_event, userId: string) => {
    try {
      removePermittedUser(userId);
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mod:getPermittedUsers', () => {
    try {
      return ok(listPermittedUsers());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mod:getStatus', () => {
    try {
      return ok(getModStatus());
    } catch (err) {
      return fail(err);
    }
  });
}
