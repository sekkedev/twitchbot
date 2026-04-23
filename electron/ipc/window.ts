import { BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

interface PopoutRequest {
  route: string;
  title?: string;
  width?: number;
  height?: number;
  id?: string;
}

const popouts = new Map<string, BrowserWindow>();

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

function buildPopoutUrl(route: string): string {
  const normalized = route.startsWith('/') ? route : `/${route}`;
  if (isDev) {
    return `${DEV_URL}/#${normalized}`;
  }
  const filePath = path.join(__dirname, '..', 'dist', 'index.html');
  return `file:///${filePath.replace(/\\/g, '/')}#${normalized}`;
}

export function registerWindowHandlers(): void {
  ipcMain.handle('window:popout', (_event, payload: PopoutRequest) => {
    try {
      const id = payload.id ?? payload.route;
      const existing = popouts.get(id);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return ok({ reused: true });
      }

      const win = new BrowserWindow({
        width: payload.width ?? 520,
        height: payload.height ?? 760,
        minWidth: 360,
        minHeight: 360,
        title: payload.title ?? 'TwitchBot',
        backgroundColor: '#0e0e10',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          // main.ts lives at dist-electron/main.js; we live at dist-electron/ipc/window.js
          preload: path.join(__dirname, '..', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.show();
      });

      void win.loadURL(buildPopoutUrl(payload.route));

      win.webContents.setWindowOpenHandler(({ url: outUrl }) => {
        shell.openExternal(outUrl);
        return { action: 'deny' };
      });

      win.on('closed', () => {
        popouts.delete(id);
      });

      popouts.set(id, win);
      return ok({ reused: false });
    } catch (err) {
      console.error('[window] popout failed:', err);
      return fail(err);
    }
  });

  ipcMain.handle('window:close-self', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.close();
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });
}
