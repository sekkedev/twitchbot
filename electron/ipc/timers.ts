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
import { numberIdSchema, timerInputSchema, timerUpdateSchema } from './validation';

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
      return ok(createTimer(timerInputSchema.parse(input) as TimerInput));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('timers:update', (_event, update: TimerUpdate) => {
    try {
      return ok(updateTimer(timerUpdateSchema.parse(update) as TimerUpdate));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('timers:delete', (_event, id: number) => {
    try {
      deleteTimer(numberIdSchema.parse(id));
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('timers:toggle', (_event, id: number) => {
    try {
      return ok(toggleTimer(numberIdSchema.parse(id)));
    } catch (err) {
      return fail(err);
    }
  });
}
