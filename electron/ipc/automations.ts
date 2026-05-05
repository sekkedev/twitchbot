import { BrowserWindow, ipcMain } from 'electron';
import {
  addSoundFromDialog,
  createAutomation,
  deleteAutomation,
  deleteSound,
  getSoundsDirectory,
  listAutomations,
  listSounds,
  testAutomation,
  toggleAutomation,
  updateAutomation,
  type AutomationInput,
  type AutomationUpdate,
} from '../services/automation-engine';
import {
  deleteWebhook,
  getWebhookUrl,
  listWebhooks,
  saveWebhook,
  testWebhookUrl,
} from '../services/discord-webhooks';
import { automationInputSchema, automationUpdateSchema, numberIdSchema } from './validation';

type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

const ok = <T>(data: T): IpcResult<T> => ({ success: true, data });
const fail = (err: unknown): IpcResult<never> => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export function registerAutomationHandlers(): void {
  ipcMain.handle('automations:list', () => {
    try {
      return ok(listAutomations());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('automations:create', (_event, input: AutomationInput) => {
    try {
      return ok(createAutomation(automationInputSchema.parse(input) as AutomationInput));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('automations:update', (_event, update: AutomationUpdate) => {
    try {
      return ok(updateAutomation(automationUpdateSchema.parse(update) as AutomationUpdate));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('automations:delete', (_event, id: number) => {
    try {
      deleteAutomation(numberIdSchema.parse(id));
      return ok(null);
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('automations:toggle', (_event, id: number) => {
    try {
      return ok(toggleAutomation(numberIdSchema.parse(id)));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('automations:test', (_event, input: AutomationInput) => {
    try {
      return ok(testAutomation(automationInputSchema.parse(input) as AutomationInput));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('discord-webhooks:list', () => {
    try {
      return ok(listWebhooks());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'discord-webhooks:save',
    (_event, payload: { key: string; url: string }) => {
      try {
        saveWebhook(payload.key, payload.url);
        return ok(listWebhooks());
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle('discord-webhooks:delete', (_event, key: string) => {
    try {
      deleteWebhook(key);
      return ok(listWebhooks());
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle(
    'discord-webhooks:test',
    async (_event, payload: { key: string; url?: string }) => {
      try {
        const url = payload.url ?? getWebhookUrl(payload.key);
        if (!url) throw new Error('Webhook URL is empty.');
        await testWebhookUrl(url);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },
  );

  ipcMain.handle('sounds:list', async () => {
    try {
      return ok({
        directory: getSoundsDirectory(),
        files: await listSounds(),
      });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('sounds:add', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      return ok(await addSoundFromDialog(window));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('sounds:delete', async (_event, name: string) => {
    try {
      await deleteSound(name);
      return ok(await listSounds());
    } catch (err) {
      return fail(err);
    }
  });
}
