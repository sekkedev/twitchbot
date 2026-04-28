const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isSafeExternalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost')) return false;
  if (isPrivateIp(host)) return false;

  return true;
}

export function validateDiscordWebhookUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Discord webhook URL is invalid.');
  }

  const host = parsed.hostname.toLowerCase();
  const allowedHost = host === 'discord.com' || host === 'discordapp.com';
  if (
    parsed.protocol !== 'https:' ||
    !allowedHost ||
    !parsed.pathname.startsWith('/api/webhooks/')
  ) {
    throw new Error('Discord webhook URL must be a Discord API webhook URL.');
  }

  return parsed.toString();
}

function isPrivateIp(host: string): boolean {
  if (isPrivateIpv4(host)) return true;
  return isPrivateIpv6(host.replace(/^\[|\]$/g, ''));
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n, i) => !Number.isInteger(n) || n < 0 || n > 255 || String(n) !== parts[i])) {
    return false;
  }

  const [a, b] = nums as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (!normalized.includes(':')) return false;
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}
