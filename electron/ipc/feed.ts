import { ipcMain } from 'electron';
import { getFeedSnapshot } from '../services/feed-buffer';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });

export function registerFeedHandlers(): void {
  ipcMain.handle('feed:snapshot', () => ok(getFeedSnapshot()));
}
