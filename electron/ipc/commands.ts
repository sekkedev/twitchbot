import { ipcMain } from 'electron';
import {
  createCommand,
  deleteCommand,
  listCommands,
  updateCommand,
  type CommandInput,
  type CommandUpdate,
} from '../services/command-engine';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerCommandHandlers(): void {
  ipcMain.handle('commands:list', () => {
    try {
      return ok(listCommands());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('commands:create', (_event, input: CommandInput) => {
    try {
      return ok(createCommand(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('commands:update', (_event, update: CommandUpdate) => {
    try {
      return ok(updateCommand(update));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('commands:delete', (_event, id: number) => {
    try {
      deleteCommand(id);
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });
}
