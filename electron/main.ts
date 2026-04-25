import { app, BrowserWindow, session, shell } from 'electron';
import dotenv from 'dotenv';
import path from 'node:path';
import { registerAnalyticsHandlers } from './ipc/analytics';
import { registerAuthHandlers } from './ipc/auth';
import { registerBotHandlers } from './ipc/bot';
import { registerCommandHandlers } from './ipc/commands';
import { registerCredentialHandlers } from './ipc/credentials';
import { registerDbHandlers } from './ipc/db';
import { registerDevHandlers } from './ipc/dev';
import { registerDiagnosticsHandlers } from './ipc/diagnostics';
import { registerFeedHandlers } from './ipc/feed';
import { registerModerationHandlers } from './ipc/moderation';
import { registerSessionHandlers } from './ipc/sessions';
import { registerSettingsHandlers } from './ipc/settings';
import { registerTimerHandlers } from './ipc/timers';
import { registerUserHandlers } from './ipc/users';
import { registerWindowHandlers } from './ipc/window';
import { closeDatabase, initDatabase } from './services/database';
import { loadCredentialsFromDisk } from './services/credentials';
import { closeDanglingSession } from './services/streak-tracker';
import { loadTokensFromDisk } from './services/twitch-auth';
import { disconnectBot } from './services/twitch-chat';

dotenv.config({ path: path.join(app.getAppPath(), '.env') });

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0e0e10',
    title: 'TwitchBot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Lock down the content security policy for packaged builds. We can't apply
 * the same policy in dev because Vite's HMR injects inline modules + uses
 * eval for some transforms.
 */
function installProductionCsp(): void {
  if (isDev) return;
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://id.twitch.tv https://api.twitch.tv wss://eventsub.wss.twitch.tv wss://irc-ws.chat.twitch.tv",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

app.whenReady().then(async () => {
  try {
    initDatabase();
    closeDanglingSession();
  } catch (err) {
    console.error('[db] failed to initialize:', err);
    app.quit();
    return;
  }

  // Credentials override .env. Loading here means subsequent OAuth attempts
  // pick up user-configured values without a restart.
  loadCredentialsFromDisk();

  installProductionCsp();

  registerAuthHandlers();
  registerBotHandlers();
  registerCommandHandlers();
  registerTimerHandlers();
  registerModerationHandlers();
  registerSessionHandlers();
  registerUserHandlers();
  registerAnalyticsHandlers();
  registerSettingsHandlers();
  registerWindowHandlers();
  registerDbHandlers();
  registerDiagnosticsHandlers();
  registerFeedHandlers();
  registerCredentialHandlers();
  registerDevHandlers();

  try {
    const tokens = await loadTokensFromDisk();
    if (tokens) {
      console.log(`[auth] restored session for ${tokens.user.display_name}`);
    }
  } catch (err) {
    console.warn('[auth] failed to restore session:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  try {
    await disconnectBot();
  } catch {
    // ignore
  }
  closeDatabase();
});
