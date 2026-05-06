import { z } from 'zod';
import type { Role } from '../lib/command-logic';
import type { AutomationEventType } from '../services/automation-engine';

export const numberIdSchema = z.number().int().positive();
export const twitchIdSchema = z.string().min(1).max(100);
export const usernameSchema = z.string().min(1).max(100);
export const sortDirectionSchema = z.enum(['asc', 'desc']).optional();
export const sortKeySchema = z.enum(['exp', 'level', 'watch_time', 'messages', 'username', 'last_seen']).optional();
export const searchSchema = z.string().trim().min(1).max(100).optional();
export const roleSchema = z.enum(['everyone', 'follower', 'vip', 'subscriber', 'moderator', 'broadcaster']);
export const automationEventTypeSchema = z.enum(['follow', 'subscription', 'sub_gift', 'cheer', 'raid', 'stream_online', 'stream_offline']) satisfies z.ZodType<AutomationEventType>;

export const commandInputSchema = z.object({
  name: z.string().min(1).max(100),
  response: z.string().min(1).max(5000),
  cooldown_seconds: z.number().int().min(0).max(3600).optional(),
  permissions: z.array(roleSchema).optional(),
  enabled: z.boolean().optional(),
}) satisfies z.ZodType<{
  name: string;
  response: string;
  cooldown_seconds?: number;
  permissions?: Role[];
  enabled?: boolean;
}>;

export const commandUpdateSchema = commandInputSchema.partial().extend({
  id: numberIdSchema,
}) satisfies z.ZodType<{
  id: number;
  name?: string;
  response?: string;
  cooldown_seconds?: number;
  permissions?: Role[];
  enabled?: boolean;
}>;

export const automationInputSchema = z.object({
  name: z.string().min(1).max(200),
  event_type: automationEventTypeSchema,
  conditions: z.array(z.unknown()).optional(),
  actions: z.array(z.unknown()).optional(),
  cooldown_seconds: z.number().int().min(0).max(86400).optional(),
  enabled: z.boolean().optional(),
}) satisfies z.ZodType<{
  name: string;
  event_type: AutomationEventType;
  conditions?: unknown[];
  actions?: unknown[];
  cooldown_seconds?: number;
  enabled?: boolean;
}>;

export const automationUpdateSchema = automationInputSchema.partial().extend({
  id: numberIdSchema,
}) satisfies z.ZodType<{
  id: number;
  name?: string;
  event_type?: AutomationEventType;
  conditions?: unknown[];
  actions?: unknown[];
  cooldown_seconds?: number;
  enabled?: boolean;
}>;

export const timerInputSchema = z.object({
  name: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  interval_seconds: z.number().int().min(5).max(86400).optional(),
  min_chat_lines: z.number().int().min(0).max(100000).optional(),
  enabled: z.boolean().optional(),
});

export const timerUpdateSchema = timerInputSchema.partial().extend({
  id: numberIdSchema,
});

export const popoutRequestSchema = z.object({
  route: z.string().min(1).max(200),
  title: z.string().min(1).max(200).optional(),
  width: z.number().int().min(360).max(4000).optional(),
  height: z.number().int().min(360).max(4000).optional(),
  id: z.string().min(1).max(200).optional(),
});

export const listUsersOptionsSchema = z.object({
  sort: sortKeySchema,
  direction: sortDirectionSchema,
  search: searchSchema,
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const userExpPayloadSchema = z.object({
  twitchId: twitchIdSchema,
  delta: z.number().finite(),
  reason: z.string().max(500).optional(),
});

export const userResetPayloadSchema = z.object({
  twitchId: twitchIdSchema.optional(),
});

const modSettingValueSchema = z.union([z.string().max(10000), z.number().finite(), z.boolean()]);

export const modUpdateSettingsSchema = z.record(
  z.string().min(1).max(100),
  modSettingValueSchema,
);

export const modWarningFiltersSchema = z
  .object({
    user_id: z.string().min(1).max(100).optional(),
    rule: z.string().min(1).max(50).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .optional();

export const modWarningsPageParamsSchema = z
  .object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
    ruleFilter: z.string().min(1).max(50).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  })
  .optional();

export const modPermittedUserSchema = z.object({
  user_id: twitchIdSchema,
  username: usernameSchema,
});

export const modClearWarningsSchema = z
  .object({
    user_id: twitchIdSchema.optional(),
  })
  .optional();

const discordEmbedFieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(1024),
  inline: z.boolean().optional(),
});

export const discordEmbedSchema = z.object({
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  author: z
    .object({
      name: z.string().min(1).max(256),
      icon_url: z.string().url().max(2000).optional(),
    })
    .optional(),
  thumbnail: z.object({ url: z.string().url().max(2000) }).optional(),
  fields: z.array(discordEmbedFieldSchema).max(25).optional(),
  footer: z.object({ text: z.string().min(1).max(2048) }).optional(),
  timestamp: z.boolean().optional(),
});

export const webhookTemplateNameSchema = z.string().min(1).max(200);
export const webhookKeySchema = z.string().min(1).max(100);

export const webhookSaveTemplateSchema = z.object({
  name: webhookTemplateNameSchema,
  embed: discordEmbedSchema,
});

export const webhookTestEmbedSchema = z.object({
  webhook_key: webhookKeySchema,
  embed: discordEmbedSchema,
});
