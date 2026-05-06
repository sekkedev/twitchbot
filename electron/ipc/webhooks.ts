import { ipcMain } from 'electron';
import {
  deleteEmbedTemplate,
  listEmbedTemplates,
  saveEmbedTemplate,
  testEmbed,
  type DiscordEmbed,
} from '../services/discord-webhooks';
import {
  webhookSaveTemplateSchema,
  webhookTemplateNameSchema,
  webhookTestEmbedSchema,
} from './validation';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerWebhookHandlers(): void {
  ipcMain.handle('webhooks:getTemplates', () => {
    try {
      return ok(listEmbedTemplates());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'webhooks:saveTemplate',
    (_event, payload: { name: string; embed: DiscordEmbed }) => {
      try {
        const parsed = webhookSaveTemplateSchema.parse(payload);
        saveEmbedTemplate(parsed.name, parsed.embed as DiscordEmbed);
        return ok(listEmbedTemplates());
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle('webhooks:deleteTemplate', (_event, name: string) => {
    try {
      deleteEmbedTemplate(webhookTemplateNameSchema.parse(name));
      return ok(listEmbedTemplates());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'webhooks:testEmbed',
    async (_event, payload: { webhook_key: string; embed: DiscordEmbed }) => {
      try {
        const parsed = webhookTestEmbedSchema.parse(payload);
        await testEmbed(parsed.webhook_key, parsed.embed as DiscordEmbed);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
