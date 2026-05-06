import { ipcMain } from 'electron';
import {
  addPermittedUser,
  clearWarnings,
  getModSettings,
  getModStats,
  getModStatus,
  listPermittedUsers,
  listWarnings,
  listWarningsPage,
  removePermittedUser,
  updateModSettings,
  type ModWarningFilters,
  type ModWarningsPageParams,
} from '../services/moderation-service';
import {
  modClearWarningsSchema,
  modPermittedUserSchema,
  modUpdateSettingsSchema,
  modWarningFiltersSchema,
  modWarningsPageParamsSchema,
  twitchIdSchema,
} from './validation';

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
      return ok(updateModSettings(modUpdateSettingsSchema.parse(updates)));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mod:getWarnings', (_event, filters?: ModWarningFilters) => {
    try {
      return ok(listWarnings(modWarningFiltersSchema.parse(filters) as ModWarningFilters | undefined));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('mod:clearWarnings', (_event, payload?: { user_id?: string }) => {
    try {
      const parsed = modClearWarningsSchema.parse(payload);
      return ok(clearWarnings(parsed?.user_id));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'mod:addPermittedUser',
    (_event, payload: { user_id: string; username: string }) => {
      try {
        const parsed = modPermittedUserSchema.parse(payload);
        return ok(addPermittedUser(parsed.user_id, parsed.username));
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle('mod:removePermittedUser', (_event, userId: string) => {
    try {
      removePermittedUser(twitchIdSchema.parse(userId));
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

  ipcMain.handle('mod:getStats', () => {
    try {
      return ok(getModStats());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'mod:getWarningsPage',
    (_event, params?: ModWarningsPageParams) => {
      try {
        const parsed = modWarningsPageParamsSchema.parse(params) as ModWarningsPageParams | undefined;
        return ok(listWarningsPage(parsed ?? {}));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
