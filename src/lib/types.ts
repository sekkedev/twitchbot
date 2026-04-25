export interface AuthStatus {
  loggedIn: boolean;
  username: string | null;
  channel: string | null;
  scopes: string[];
}

export type BotState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BotStatus {
  state: BotState;
  error: string | null;
}

export interface SessionRow {
  id: number;
  started_at: string;
  ended_at: string | null;
  peak_viewers: number;
}

export type Role =
  | 'everyone'
  | 'follower'
  | 'vip'
  | 'subscriber'
  | 'moderator'
  | 'broadcaster';

export interface Command {
  id: number;
  name: string;
  response: string;
  cooldown_seconds: number;
  permissions: Role[];
  enabled: boolean;
  usage_count: number;
  created_at: string;
}

export interface Timer {
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

export interface ModWarning {
  id: number;
  user_id: string;
  username: string;
  rule: string;
  message_text: string | null;
  action_taken: string;
  created_at: number;
}

export interface PermittedUser {
  user_id: string;
  username: string;
  created_at: number;
}

export interface ModStatus {
  botMustBeMod: boolean;
  missingScopes: string[];
}

export interface UserRow {
  twitch_id: string;
  username: string;
  exp: number;
  level: number;
  watch_time_minutes: number;
  messages_sent: number;
  watch_streak: number;
  best_watch_streak: number;
  last_stream_attended: number | null;
  first_seen: string;
  last_seen: string;
  rank: number;
}

export interface EventRow {
  id: number;
  type: string;
  twitch_user_id: string;
  data: string | null;
  exp_awarded: number;
  created_at: string;
}

export interface UserProfile extends UserRow {
  events: EventRow[];
}

export interface OverviewStats {
  totalUsers: number;
  totalExp: number;
  totalSessions: number;
  activeSessions: number;
  totalCommandUses: number;
  totalMessages: number;
  topChatters: Array<{ username: string; messages_sent: number }>;
  topByExp: Array<{ username: string; exp: number; level: number }>;
}

export type ActivityRange = 'day' | 'week' | 'month';

export interface ActivityBucket {
  bucket: string;
  messages: number;
  exp: number;
}

export interface ActivityData {
  range: ActivityRange;
  buckets: ActivityBucket[];
  topCommands: Array<{ name: string; usage_count: number }>;
  sessions: SessionRow[];
}

export interface ChatMessagePayload {
  id: string | null;
  user: {
    id: string;
    login: string;
    displayName: string;
    color: string | null;
    roles: {
      broadcaster: boolean;
      moderator: boolean;
      vip: boolean;
      subscriber: boolean;
    };
  };
  message: string;
  emotes: Record<string, string[]> | null;
  timestamp: string;
  channel: string;
}
