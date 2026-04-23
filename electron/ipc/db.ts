import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getDatabase } from '../services/database';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerDbHandlers(): void {
  ipcMain.handle('db:export', async (event) => {
    try {
      const db = getDatabase();

      const win = BrowserWindow.fromWebContents(event.sender);
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const suggested = `twitchbot-${timestamp}.db`;

      const dialogOptions = {
        title: 'Export TwitchBot database',
        defaultPath: suggested,
        filters: [
          { name: 'SQLite database', extensions: ['db'] },
          { name: 'All files', extensions: ['*'] },
        ],
      };
      const result = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      if (result.canceled || !result.filePath) {
        return ok({ canceled: true, path: null as string | null });
      }

      // Use SQLite's online backup API — safe to call while the app writes.
      // Unlike a naive file copy, this flushes WAL and produces a consistent
      // snapshot.
      await db.backup(result.filePath);

      return ok({ canceled: false, path: result.filePath });
    } catch (err) {
      console.error('[db:export]', err);
      return fail(err);
    }
  });
}
