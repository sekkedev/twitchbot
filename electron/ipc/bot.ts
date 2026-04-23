import { ipcMain } from 'electron';
import { connectBot, disconnectBot, getBotState } from '../services/twitch-chat';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerBotHandlers(): void {
  ipcMain.handle('bot:connect', async () => {
    try {
      await connectBot();
      return ok(getBotState());
    } catch (err) {
      console.error('[bot:connect]', err);
      return fail(err);
    }
  });

  ipcMain.handle('bot:disconnect', async () => {
    try {
      await disconnectBot();
      return ok(getBotState());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('bot:state', () => ok(getBotState()));
}
