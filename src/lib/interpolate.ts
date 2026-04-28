/**
 * Mirror of electron/lib/command-logic.ts → interpolate. Kept renderer-local
 * because importing across the electron/src boundary would pull node-only deps.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`,
  );
}
