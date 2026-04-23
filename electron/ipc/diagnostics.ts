import { ipcMain } from 'electron';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });

interface RenderErrorPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  route?: string;
}

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle('log:render-error', (_event, payload: RenderErrorPayload) => {
    const route = payload.route ? ` [${payload.route}]` : '';
    console.error(`[renderer-crash]${route} ${payload.message}`);
    if (payload.stack) console.error(payload.stack);
    if (payload.componentStack) {
      console.error('Component stack:', payload.componentStack);
    }
    return ok(null);
  });
}
