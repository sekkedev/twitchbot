/**
 * Command engine pure helpers — permission checks, name validation, template
 * interpolation. No runtime deps.
 */

export type Role =
  | 'everyone'
  | 'follower'
  | 'vip'
  | 'subscriber'
  | 'moderator'
  | 'broadcaster';

export interface UserRoles {
  broadcaster: boolean;
  moderator: boolean;
  vip: boolean;
  subscriber: boolean;
  follower?: boolean;
}

/**
 * Set-based permission check. Broadcaster always passes; `everyone` short-circuits
 * all other roles; otherwise the user's roles must intersect the command's roles.
 * `follower` is intentionally not verified here — the caller must resolve that.
 */
export function canExecute(permissions: Role[], roles: UserRoles): boolean {
  if (roles.broadcaster) return true;
  if (permissions.includes('everyone')) return true;
  if (permissions.includes('moderator') && roles.moderator) return true;
  if (permissions.includes('vip') && roles.vip) return true;
  if (permissions.includes('subscriber') && roles.subscriber) return true;
  if (permissions.includes('follower') && roles.follower) return true;
  return false;
}

/**
 * Replace `{name}` tokens with values from vars. Unknown tokens are left intact
 * so missing variables are visually obvious rather than silently dropped.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`,
  );
}

/**
 * Parse the JSON permissions column. Falls back to ['everyone'] on any
 * malformed input so a bad DB row can't break command execution.
 */
export function safeParsePermissions(json: string): Role[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is Role => typeof x === 'string');
    }
  } catch {
    // fall through
  }
  return ['everyone'];
}

/**
 * Normalize a user-provided command name: trim, lowercase, and strip any
 * leading prefix characters (`!`, `/`). The result still needs to pass
 * `validateCommandName` before it's safe to store.
 */
export function normalizeCommandName(name: string): string {
  return name.trim().toLowerCase().replace(/^[!/]+/, '');
}

const NAME_RE = /^[a-z0-9_-]{1,40}$/;

export function validateCommandName(name: string): { valid: boolean; reason?: string } {
  if (!NAME_RE.test(name)) {
    return {
      valid: false,
      reason:
        'Command name must be 1–40 characters of lowercase letters, numbers, dashes, or underscores.',
    };
  }
  return { valid: true };
}
