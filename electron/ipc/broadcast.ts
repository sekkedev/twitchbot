import { BrowserWindow } from 'electron';
import { recordFeedEvent } from '../services/feed-buffer';

export function broadcast(channel: string, payload?: unknown): void {
  recordFeedEvent(channel, payload);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
