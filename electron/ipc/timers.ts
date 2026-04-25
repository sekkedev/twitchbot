import { ipcMain } from 'electron';
import {
  createTimer,
  deleteTimer,
  listTimers,
  toggleTimer,
  updateTimer,
  type TimerInput,
  type TimerUpdate,
} from '../services/timers-service';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerTimerHandlers(): void {
  ipcMain.handle('timers:list', () => {
    try {
      return ok(listTimers());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('timers:create', (_event, input: TimerInput) => {
    try {
      return ok(createTimer(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('timers:update', (_event, update: TimerUpdate) => {
    try {
      return ok(updateTimer(update));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('timers:delete', (_event, id: number) => {
    try {
      deleteTimer(id);
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('timers:toggle', (_event, id: number) => {
    try {
      return ok(toggleTimer(id));
    } catch (err) {
      return fail(err);
    }
  });
}
