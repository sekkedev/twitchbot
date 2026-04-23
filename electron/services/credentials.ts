import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * User-supplied Twitch application credentials. Stored encrypted at rest via
 * Electron's safeStorage so non-technical users can set them through the UI
 * instead of hand-editing a .env file.
 *
 * Priority at startup:
 *   1. `credentials.json` (written by the UI) — wins if present
 *   2. `.env` (loaded by dotenv before we run) — fallback for dev setups
 *
 * Either source populates `process.env.TWITCH_CLIENT_ID` and
 * `process.env.TWITCH_CLIENT_SECRET`, which every other service reads.
 */

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

interface CredentialsFile {
  version: 1;
  encrypted: string;
}

function credentialsFilePath(): string {
  return path.join(app.getPath('userData'), 'credentials.json');
}

export function loadCredentialsFromDisk(): void {
  const file = credentialsFilePath();
  if (!fs.existsSync(file)) return;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[credentials] safeStorage not available; skipping load');
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as CredentialsFile;
    if (raw.version !== 1) return;
    const decrypted = safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64'));
    const parsed = JSON.parse(decrypted) as Partial<Credentials>;
    if (parsed.clientId) process.env.TWITCH_CLIENT_ID = parsed.clientId;
    if (parsed.clientSecret) process.env.TWITCH_CLIENT_SECRET = parsed.clientSecret;
    console.log('[credentials] loaded from disk');
  } catch (err) {
    console.warn('[credentials] failed to read credentials.json:', err);
  }
}

export function getCredentials(): Credentials {
  return {
    clientId: process.env.TWITCH_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET?.trim() ?? '',
  };
}

export function hasCredentials(): boolean {
  const c = getCredentials();
  return c.clientId.length > 0 && c.clientSecret.length > 0;
}

export function saveCredentials(creds: Credentials): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encrypted storage is not available on this platform.');
  }
  validate(creds);

  const encrypted = safeStorage
    .encryptString(JSON.stringify(creds))
    .toString('base64');
  const payload: CredentialsFile = { version: 1, encrypted };

  fs.writeFileSync(credentialsFilePath(), JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  process.env.TWITCH_CLIENT_ID = creds.clientId;
  process.env.TWITCH_CLIENT_SECRET = creds.clientSecret;
}

export function clearCredentials(): void {
  const file = credentialsFilePath();
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  // Don't touch process.env — .env might still provide values the user wants.
}

function validate(creds: Credentials): void {
  const id = creds.clientId.trim();
  const secret = creds.clientSecret.trim();
  if (!id) throw new Error('Client ID is required.');
  if (!secret) throw new Error('Client Secret is required.');
  if (!/^[a-z0-9]{20,50}$/i.test(id)) {
    throw new Error(
      'Client ID must be 20–50 alphanumeric characters (Twitch issues 30-char IDs).',
    );
  }
  if (!/^[a-z0-9]{20,80}$/i.test(secret)) {
    throw new Error(
      'Client Secret must be 20–80 alphanumeric characters.',
    );
  }
}
