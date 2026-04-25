import { getDatabase } from './database';

export interface TimerRow {
  id: number;
  name: string;
  message: string;
  interval_seconds: number;
  min_chat_lines: number;
  enabled: boolean;
  last_fired_at: number | null;
  created_at: number;
  updated_at: number;
}

interface TimerDbRow {
  id: number;
  name: string;
  message: string;
  interval_seconds: number;
  min_chat_lines: number;
  enabled: number;
  last_fired_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TimerInput {
  name: string;
  message: string;
  interval_seconds?: number;
  min_chat_lines?: number;
  enabled?: boolean;
}

export interface TimerUpdate {
  id: number;
  name?: string;
  message?: string;
  interval_seconds?: number;
  min_chat_lines?: number;
  enabled?: boolean;
}

const chatLinesSinceFire = new Map<number, number>();

export function listTimers(): TimerRow[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM timers ORDER BY name COLLATE NOCASE')
    .all() as TimerDbRow[];
  return rows.map(rowToTimer);
}

export function createTimer(input: TimerInput): TimerRow {
  const normalized = normalizeTimerInput(input);
  const info = getDatabase()
    .prepare(
      `INSERT INTO timers (name, message, interval_seconds, min_chat_lines, enabled)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      normalized.name,
      normalized.message,
      normalized.interval_seconds,
      normalized.min_chat_lines,
      normalized.enabled ? 1 : 0,
    );
  return getTimer(Number(info.lastInsertRowid));
}

export function updateTimer(update: TimerUpdate): TimerRow {
  const existing = getTimer(update.id);
  const normalized = normalizeTimerInput({
    name: update.name ?? existing.name,
    message: update.message ?? existing.message,
    interval_seconds: update.interval_seconds ?? existing.interval_seconds,
    min_chat_lines: update.min_chat_lines ?? existing.min_chat_lines,
    enabled: update.enabled ?? existing.enabled,
  });

  getDatabase()
    .prepare(
      `UPDATE timers
       SET name = ?, message = ?, interval_seconds = ?, min_chat_lines = ?,
           enabled = ?, updated_at = unixepoch()
       WHERE id = ?`,
    )
    .run(
      normalized.name,
      normalized.message,
      normalized.interval_seconds,
      normalized.min_chat_lines,
      normalized.enabled ? 1 : 0,
      update.id,
    );
  return getTimer(update.id);
}

export function deleteTimer(id: number): void {
  const info = getDatabase().prepare('DELETE FROM timers WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error(`Timer ${id} not found.`);
  chatLinesSinceFire.delete(id);
}

export function toggleTimer(id: number): TimerRow {
  const existing = getTimer(id);
  return updateTimer({ id, enabled: !existing.enabled });
}

function getTimer(id: number): TimerRow {
  const row = getDatabase()
    .prepare('SELECT * FROM timers WHERE id = ?')
    .get(id) as TimerDbRow | undefined;
  if (!row) throw new Error(`Timer ${id} not found.`);
  return rowToTimer(row);
}

function normalizeTimerInput(input: TimerInput): Required<TimerInput> {
  const name = input.name.trim();
  if (!name) throw new Error('Timer name cannot be empty.');
  const message = input.message.trim();
  if (!message) throw new Error('Timer message cannot be empty.');

  const interval = input.interval_seconds ?? 300;
  if (!Number.isInteger(interval) || interval < 15) {
    throw new Error('Timer interval must be at least 15 seconds.');
  }

  const minChatLines = input.min_chat_lines ?? 0;
  if (!Number.isInteger(minChatLines) || minChatLines < 0) {
    throw new Error('Minimum chat lines must be a non-negative integer.');
  }

  return {
    name,
    message,
    interval_seconds: interval,
    min_chat_lines: minChatLines,
    enabled: input.enabled ?? true,
  };
}

function rowToTimer(row: TimerDbRow): TimerRow {
  return {
    ...row,
    enabled: row.enabled === 1,
  };
}
