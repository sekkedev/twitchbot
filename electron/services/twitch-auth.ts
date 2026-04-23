import { app, safeStorage, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { clearCache as clearFollowerCache } from './follower-cache';

const TWITCH_AUTH_BASE = 'https://id.twitch.tv/oauth2';
const TWITCH_HELIX = 'https://api.twitch.tv/helix';

const SCOPES = [
  'chat:read',
  'chat:edit',
  'channel:read:subscriptions',
  'bits:read',
  'moderator:read:followers',
];

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const OAUTH_CALLBACK_PORT = 42817;

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
}

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: TwitchUser;
  scopes: string[];
}

interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[] | string;
  token_type: string;
}

interface TokenFilePayload {
  version: 1;
  encrypted: string;
  user: TwitchUser;
  scopes: string[];
  expires_at: number;
}

let currentTokens: StoredTokens | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function getClientId(): string {
  const id = process.env.TWITCH_CLIENT_ID?.trim();
  if (!id) {
    throw new Error(
      'TWITCH_CLIENT_ID is not set. Add it to your .env file at the project root.',
    );
  }
  return id;
}

function tokenFilePath(): string {
  return path.join(app.getPath('userData'), 'auth.json');
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateVerifier(): string {
  return base64url(crypto.randomBytes(48));
}

function deriveChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

function persistTokens(tokens: StoredTokens): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this platform.');
  }
  const secretPayload = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  const encrypted = safeStorage.encryptString(secretPayload).toString('base64');
  const payload: TokenFilePayload = {
    version: 1,
    encrypted,
    user: tokens.user,
    scopes: tokens.scopes,
    expires_at: tokens.expires_at,
  };
  fs.writeFileSync(tokenFilePath(), JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function readStoredTokens(): StoredTokens | null {
  const file = tokenFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as TokenFilePayload;
    if (raw.version !== 1) return null;
    const decrypted = safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64'));
    const secrets = JSON.parse(decrypted) as { access_token: string; refresh_token: string };
    return {
      access_token: secrets.access_token,
      refresh_token: secrets.refresh_token,
      expires_at: raw.expires_at,
      user: raw.user,
      scopes: raw.scopes,
    };
  } catch (err) {
    console.warn('[auth] failed to read stored tokens:', err);
    return null;
  }
}

function clearStoredTokens(): void {
  const file = tokenFilePath();
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

function startCallbackServer(expectedState: string): Promise<{
  port: number;
  codePromise: Promise<string>;
  close: () => void;
}> {
  return new Promise((resolveServer, rejectServer) => {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      if (!req.url) return;
      const reqUrl = new URL(req.url, 'http://localhost');
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');
      const errorParam = reqUrl.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (errorParam) {
        res.end(renderCallbackPage(false, errorParam));
        rejectCode(new Error(`Twitch returned error: ${errorParam}`));
        return;
      }
      if (!code || state !== expectedState) {
        res.end(renderCallbackPage(false, 'Invalid state or missing code.'));
        rejectCode(new Error('OAuth callback state mismatch or missing code.'));
        return;
      }
      res.end(renderCallbackPage(true));
      resolveCode(code);
    });

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        rejectServer(
          new Error(
            `Port ${OAUTH_CALLBACK_PORT} is already in use. Close whatever is using it and try again.`,
          ),
        );
      } else {
        rejectServer(err);
      }
    });
    server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectServer(new Error('Failed to bind OAuth callback server.'));
        return;
      }
      resolveServer({
        port: address.port,
        codePromise,
        close: () => server.close(),
      });
    });
  });
}

function renderCallbackPage(success: boolean, message?: string): string {
  const title = success ? 'Signed in' : 'Login failed';
  const body = success
    ? 'You can close this tab and return to TwitchBot.'
    : `Something went wrong: ${message ?? 'unknown error'}. You can close this tab.`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{height:100%;margin:0;background:#0e0e10;color:#efeff1;font-family:system-ui,sans-serif}
.wrap{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px}
h1{font-size:20px;margin:0}p{color:#adadb8;margin:0}</style></head>
<body><div class="wrap"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

async function exchangeCodeForTokens(params: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<RawTokenResponse> {
  const fields: Record<string, string> = {
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.verifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  };
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (clientSecret) fields.client_secret = clientSecret;

  const body = new URLSearchParams(fields).toString();
  console.log('[auth] exchanging code. fields:', Object.keys(fields).join(', '));

  const res = await fetch(`${TWITCH_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[auth] token exchange error body:', text);
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as RawTokenResponse;
}

async function refreshTokens(
  clientId: string,
  refreshToken: string,
): Promise<RawTokenResponse> {
  const fields: Record<string, string> = {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  };
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (clientSecret) fields.client_secret = clientSecret;

  const body = new URLSearchParams(fields).toString();
  const res = await fetch(`${TWITCH_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RawTokenResponse;
}

async function revokeToken(clientId: string, token: string): Promise<void> {
  const body = new URLSearchParams({ client_id: clientId, token });
  try {
    await fetch(`${TWITCH_AUTH_BASE}/revoke`, { method: 'POST', body });
  } catch (err) {
    console.warn('[auth] revoke failed (ignored):', err);
  }
}

async function validateToken(token: string): Promise<{
  client_id: string;
  login: string;
  user_id: string;
  expires_in: number;
  scopes: string[];
} | null> {
  const res = await fetch(`${TWITCH_AUTH_BASE}/validate`, {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    client_id: string;
    login: string;
    user_id: string;
    expires_in: number;
    scopes: string[];
  };
}

async function fetchUserProfile(clientId: string, accessToken: string): Promise<TwitchUser> {
  const res = await fetch(`${TWITCH_HELIX}/users`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch user profile: ${res.status}`);
  const json = (await res.json()) as {
    data: Array<{
      id: string;
      login: string;
      display_name: string;
      profile_image_url?: string;
    }>;
  };
  const user = json.data[0];
  if (!user) throw new Error('No user returned from Helix /users.');
  return {
    id: user.id,
    login: user.login,
    display_name: user.display_name,
    profile_image_url: user.profile_image_url,
  };
}

function scheduleRefresh(tokens: StoredTokens): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const msUntilRefresh = Math.max(tokens.expires_at - Date.now() - 5 * 60 * 1000, 60_000);
  refreshTimer = setTimeout(() => {
    void ensureValidToken().catch((err) => console.error('[auth] refresh failed:', err));
  }, msUntilRefresh);
}

export function getCurrentTokens(): StoredTokens | null {
  return currentTokens;
}

export function getAuthStatus(): {
  loggedIn: boolean;
  username: string | null;
  channel: string | null;
} {
  if (!currentTokens) return { loggedIn: false, username: null, channel: null };
  return {
    loggedIn: true,
    username: currentTokens.user.display_name,
    channel: currentTokens.user.login,
  };
}

export async function ensureValidToken(): Promise<StoredTokens | null> {
  if (!currentTokens) return null;
  const needsRefresh = currentTokens.expires_at - Date.now() < 5 * 60 * 1000;
  if (!needsRefresh) return currentTokens;

  const clientId = getClientId();
  try {
    const refreshed = await refreshTokens(clientId, currentTokens.refresh_token);
    currentTokens = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: Date.now() + refreshed.expires_in * 1000,
      user: currentTokens.user,
      scopes: normalizeScopes(refreshed.scope),
    };
    persistTokens(currentTokens);
    scheduleRefresh(currentTokens);
    return currentTokens;
  } catch (err) {
    console.error('[auth] failed to refresh, clearing tokens:', err);
    await logout();
    return null;
  }
}

export async function loadTokensFromDisk(): Promise<StoredTokens | null> {
  const stored = readStoredTokens();
  if (!stored) return null;
  currentTokens = stored;
  const validation = await validateToken(stored.access_token);
  if (validation) {
    currentTokens = {
      ...stored,
      expires_at: Date.now() + validation.expires_in * 1000,
      scopes: validation.scopes,
    };
    persistTokens(currentTokens);
    scheduleRefresh(currentTokens);
    return currentTokens;
  }
  console.log('[auth] stored token invalid, attempting refresh');
  return ensureValidToken();
}

export async function startLoginFlow(): Promise<StoredTokens> {
  const clientId = getClientId();
  const verifier = generateVerifier();
  const challenge = deriveChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');

  const { port, codePromise, close } = await startCallbackServer(state);
  const redirectUri = `http://localhost:${port}/callback`;

  const authUrl = new URL(`${TWITCH_AUTH_BASE}/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Login timed out.')), LOGIN_TIMEOUT_MS),
  );

  try {
    await shell.openExternal(authUrl.toString());
    const code = (await Promise.race([codePromise, timeout])) as string;
    const tokenResponse = await exchangeCodeForTokens({
      clientId,
      code,
      verifier,
      redirectUri,
    });
    const user = await fetchUserProfile(clientId, tokenResponse.access_token);
    const tokens: StoredTokens = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: Date.now() + tokenResponse.expires_in * 1000,
      user,
      scopes: normalizeScopes(tokenResponse.scope),
    };
    currentTokens = tokens;
    persistTokens(tokens);
    scheduleRefresh(tokens);
    return tokens;
  } finally {
    close();
  }
}

export async function logout(): Promise<void> {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (currentTokens) {
    try {
      await revokeToken(getClientId(), currentTokens.access_token);
    } catch {
      // best-effort
    }
  }
  currentTokens = null;
  clearStoredTokens();
  clearFollowerCache();
}

function normalizeScopes(scope: string[] | string): string[] {
  if (Array.isArray(scope)) return scope;
  return scope.split(/\s+/).filter(Boolean);
}
