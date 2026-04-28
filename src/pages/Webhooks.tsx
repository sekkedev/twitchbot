import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { interpolate } from '../lib/interpolate';
import { invoke, tryInvoke } from '../lib/ipc';
import type {
  DiscordEmbed,
  DiscordEmbedField,
  EmbedTemplate,
} from '../lib/types';

interface WebhookEntry {
  key: string;
  url: string;
}

const PREVIEW_VARS: Record<string, string | number> = {
  user: 'PreviewUser',
  event: 'follow',
  level: 12,
  raid_viewers: 42,
  bits: 500,
  tier: '1000',
  total: 5,
};

const DEFAULT_EMBED: DiscordEmbed = {
  title: '{user} just followed!',
  description: 'Welcome to the stream — current level **{level}**.',
  color: 0x9146ff,
  author: { name: '{user}' },
  fields: [],
  footer: { text: 'TwitchBot' },
  timestamp: true,
};

export function Webhooks() {
  const confirm = useConfirm();
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [templates, setTemplates] = useState<EmbedTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [w, t] = await Promise.all([
      tryInvoke<WebhookEntry[]>('discord-webhooks:list'),
      tryInvoke<EmbedTemplate[]>('webhooks:getTemplates'),
    ]);
    if (w.success) setWebhooks(w.data);
    else setError(w.error);
    if (t.success) setTemplates(t.data);
    else setError(t.error);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-text">
          Webhooks
        </h2>
        <p className="text-xs text-text-dim">
          Manage Discord webhook URLs and design rich embed templates.
        </p>
      </div>

      {error && (
        <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
          {error}
        </div>
      )}
      {notice && (
        <div className="border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
          {notice}
        </div>
      )}

      <WebhookManager
        webhooks={webhooks}
        onChange={refresh}
        onError={setError}
        onNotice={flashNotice}
      />

      <EmbedTemplateSection
        templates={templates}
        webhooks={webhooks}
        confirm={confirm}
        onChange={refresh}
        onError={setError}
        onNotice={flashNotice}
      />
    </div>
  );
}

// ── Section 1: Webhook URL manager ──────────────────────────────────────────

function WebhookManager({
  webhooks,
  onChange,
  onError,
  onNotice,
}: {
  webhooks: WebhookEntry[];
  onChange: () => Promise<void>;
  onError: (msg: string | null) => void;
  onNotice: (msg: string) => void;
}) {
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');

  const save = async () => {
    onError(null);
    try {
      await invoke('discord-webhooks:save', { key, url });
      setKey('');
      setUrl('');
      await onChange();
      onNotice('Webhook saved.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const remove = async (entry: WebhookEntry) => {
    onError(null);
    try {
      await invoke('discord-webhooks:delete', entry.key);
      await onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const test = async (entry: WebhookEntry) => {
    onError(null);
    try {
      await invoke('discord-webhooks:test', { key: entry.key });
      onNotice(`Test sent to ${entry.key}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Test failed.');
    }
  };

  return (
    <section className="border border-border bg-bg-panel">
      <header className="border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Webhook URLs
      </header>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-[160px_1fr_auto] gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="name (e.g. raids)"
            className="border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
            className="border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
          <button
            onClick={() => {
              void save();
            }}
            disabled={!key.trim() || !url.trim()}
            className="flex items-center gap-2 border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <PlusIcon width={14} height={14} />
            Save
          </button>
        </div>

        {webhooks.length === 0 ? (
          <div className="border border-border bg-bg px-4 py-6 text-center text-xs text-text-dim">
            No webhooks yet. Add one above.
          </div>
        ) : (
          <div className="space-y-1">
            {webhooks.map((entry) => (
              <div
                key={entry.key}
                className="grid grid-cols-[160px_1fr_auto_auto] items-center gap-2 border border-border bg-bg px-3 py-2"
              >
                <span className="font-mono text-xs text-text">{entry.key}</span>
                <span className="truncate font-mono text-[11px] text-text-muted">
                  {maskUrl(entry.url)}
                </span>
                <button
                  onClick={() => {
                    void test(entry);
                  }}
                  className="border border-border bg-bg-panel px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-muted hover:bg-bg-hover"
                >
                  Test
                </button>
                <button
                  onClick={() => {
                    void remove(entry);
                  }}
                  aria-label={`Remove webhook ${entry.key}`}
                  className="flex h-7 w-7 items-center justify-center border border-border text-text-dim hover:text-offline"
                >
                  <TrashIcon width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function maskUrl(url: string): string {
  if (url.length <= 60) return url;
  return `${url.slice(0, 40)}…${url.slice(-12)}`;
}

// ── Section 2 + 3: Embed template editor + live preview ─────────────────────

function EmbedTemplateSection({
  templates,
  webhooks,
  confirm,
  onChange,
  onError,
  onNotice,
}: {
  templates: EmbedTemplate[];
  webhooks: WebhookEntry[];
  confirm: ReturnType<typeof useConfirm>;
  onChange: () => Promise<void>;
  onError: (msg: string | null) => void;
  onNotice: (msg: string) => void;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [embed, setEmbed] = useState<DiscordEmbed>(DEFAULT_EMBED);
  const [testWebhookKey, setTestWebhookKey] = useState('');

  useEffect(() => {
    if (webhooks.length > 0 && !testWebhookKey) {
      setTestWebhookKey(webhooks[0].key);
    }
  }, [webhooks, testWebhookKey]);

  const loadTemplate = (template: EmbedTemplate) => {
    setSelectedName(template.name);
    setDraftName(template.name);
    setEmbed({
      title: '',
      description: '',
      ...template.embed,
      author: template.embed.author ?? { name: '' },
      thumbnail: template.embed.thumbnail ?? { url: '' },
      footer: template.embed.footer ?? { text: '' },
      fields: template.embed.fields ?? [],
    });
  };

  const newTemplate = () => {
    setSelectedName(null);
    setDraftName('');
    setEmbed(DEFAULT_EMBED);
  };

  const save = async () => {
    onError(null);
    try {
      await invoke('webhooks:saveTemplate', { name: draftName, embed });
      await onChange();
      setSelectedName(draftName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_'));
      onNotice('Template saved.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const remove = async () => {
    if (!selectedName) return;
    const ok = await confirm({
      title: 'Delete template',
      message: (
        <>
          Permanently delete <span className="font-mono text-text">{selectedName}</span>?
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    onError(null);
    try {
      await invoke('webhooks:deleteTemplate', selectedName);
      await onChange();
      newTemplate();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const sendTest = async () => {
    onError(null);
    try {
      if (!testWebhookKey) throw new Error('Pick a webhook first.');
      await invoke('webhooks:testEmbed', {
        webhook_key: testWebhookKey,
        embed,
      });
      onNotice(`Test embed sent via ${testWebhookKey}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Test failed.');
    }
  };

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[260px_1fr_360px]">
      {/* Template list */}
      <section className="border border-border bg-bg-panel">
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-dim">
            Templates
          </span>
          <button
            onClick={newTemplate}
            aria-label="New template"
            className="flex h-6 w-6 items-center justify-center border border-border text-text-muted hover:bg-bg-hover hover:text-text"
          >
            <PlusIcon width={12} height={12} />
          </button>
        </header>
        <div className="space-y-0.5 p-2">
          {templates.length === 0 && (
            <div className="px-2 py-3 text-xs text-text-dim">No templates yet.</div>
          )}
          {templates.map((template) => (
            <button
              key={template.name}
              onClick={() => loadTemplate(template)}
              className={`block w-full truncate border-l-2 px-2 py-1.5 text-left text-xs ${
                selectedName === template.name
                  ? 'border-accent bg-accent/5 text-text'
                  : 'border-transparent text-text-muted hover:bg-bg-hover hover:text-text'
              }`}
            >
              <span className="font-mono">{template.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Editor */}
      <section className="border border-border bg-bg-panel">
        <header className="border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
          {selectedName ? `Editing ${selectedName}` : 'New template'}
        </header>
        <div className="space-y-4 p-4">
          <Field label="Template name">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="raid-alert"
              className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
            />
          </Field>

          <EmbedFields embed={embed} onChange={setEmbed} />

          <div className="border-t border-border pt-3">
            <Field label="Send test via">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <select
                  value={testWebhookKey}
                  onChange={(e) => setTestWebhookKey(e.target.value)}
                  disabled={webhooks.length === 0}
                  className="border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent disabled:opacity-50"
                >
                  {webhooks.length === 0 ? (
                    <option>(no webhooks)</option>
                  ) : (
                    webhooks.map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.key}
                      </option>
                    ))
                  )}
                </select>
                <button
                  onClick={() => {
                    void sendTest();
                  }}
                  disabled={webhooks.length === 0}
                  className="border border-border bg-bg-panel px-3 py-1.5 text-xs uppercase tracking-wider text-text-muted hover:bg-bg-hover disabled:opacity-50"
                >
                  Test embed
                </button>
                <button
                  onClick={() => {
                    void save();
                  }}
                  disabled={!draftName.trim()}
                  className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </Field>
            {selectedName && (
              <button
                onClick={() => {
                  void remove();
                }}
                className="mt-3 text-xs text-offline hover:underline"
              >
                Delete template
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Live preview */}
      <section className="border border-border bg-bg-panel">
        <header className="border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
          Live preview
        </header>
        <div className="p-4">
          <DiscordPreview embed={embed} vars={PREVIEW_VARS} />
          <div className="mt-3 text-[10px] text-text-dim">
            Variables: {'{user} {event} {level} {raid_viewers} {bits} {tier} {total}'}
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Embed editor fields ──

function EmbedFields({
  embed,
  onChange,
}: {
  embed: DiscordEmbed;
  onChange: (next: DiscordEmbed) => void;
}) {
  const update = (patch: Partial<DiscordEmbed>) => onChange({ ...embed, ...patch });

  const updateAuthor = (patch: Partial<NonNullable<DiscordEmbed['author']>>) => {
    onChange({
      ...embed,
      author: { name: '', ...embed.author, ...patch },
    });
  };

  const updateThumbnail = (url: string) => {
    onChange({ ...embed, thumbnail: { url } });
  };

  const updateFooter = (text: string) => {
    onChange({ ...embed, footer: { text } });
  };

  const updateField = (index: number, patch: Partial<DiscordEmbedField>) => {
    const fields = [...(embed.fields ?? [])];
    const current = fields[index];
    if (!current) return;
    fields[index] = { ...current, ...patch };
    onChange({ ...embed, fields });
  };

  const addField = () => {
    onChange({
      ...embed,
      fields: [...(embed.fields ?? []), { name: '', value: '', inline: false }],
    });
  };

  const removeField = (index: number) => {
    onChange({
      ...embed,
      fields: (embed.fields ?? []).filter((_, i) => i !== index),
    });
  };

  const colorHex = useMemo(
    () => `#${(embed.color ?? 0).toString(16).padStart(6, '0').slice(0, 6)}`,
    [embed.color],
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title">
          <input
            value={embed.title ?? ''}
            onChange={(e) => update({ title: e.target.value })}
            className="w-full border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </Field>
        <Field label="Color">
          <div className="grid grid-cols-[44px_1fr] gap-2">
            <input
              type="color"
              value={colorHex}
              onChange={(e) =>
                update({ color: parseInt(e.target.value.slice(1), 16) })
              }
              className="h-[34px] w-full border border-border bg-bg p-0.5"
            />
            <input
              value={colorHex}
              onChange={(e) => {
                const hex = e.target.value.replace('#', '').padStart(6, '0').slice(0, 6);
                const parsed = parseInt(hex, 16);
                if (Number.isFinite(parsed)) update({ color: parsed });
              }}
              className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
            />
          </div>
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={embed.description ?? ''}
          onChange={(e) => update({ description: e.target.value })}
          rows={3}
          className="w-full resize-none border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Author name">
          <input
            value={embed.author?.name ?? ''}
            onChange={(e) => updateAuthor({ name: e.target.value })}
            className="w-full border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </Field>
        <Field label="Author icon URL">
          <input
            value={embed.author?.icon_url ?? ''}
            onChange={(e) => updateAuthor({ icon_url: e.target.value })}
            className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Thumbnail URL">
          <input
            value={embed.thumbnail?.url ?? ''}
            onChange={(e) => updateThumbnail(e.target.value)}
            className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
        </Field>
        <Field label="Footer text">
          <input
            value={embed.footer?.text ?? ''}
            onChange={(e) => updateFooter(e.target.value)}
            className="w-full border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={Boolean(embed.timestamp)}
          onChange={(e) => update({ timestamp: e.target.checked })}
          className="h-3.5 w-3.5 accent-accent"
        />
        Include timestamp
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between border-b border-border pb-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-dim">
            Fields
          </span>
          <button
            type="button"
            onClick={addField}
            className="border border-border bg-bg px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted hover:bg-bg-hover"
          >
            Add field
          </button>
        </div>
        {(embed.fields ?? []).map((field, index) => (
          <div
            key={index}
            className="grid grid-cols-[1fr_2fr_60px_28px] items-center gap-2"
          >
            <input
              value={field.name}
              placeholder="Name"
              onChange={(e) => updateField(index, { name: e.target.value })}
              className="border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
            <input
              value={field.value}
              placeholder="Value"
              onChange={(e) => updateField(index, { value: e.target.value })}
              className="border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
            <label className="flex items-center gap-1 text-[10px] text-text-muted">
              <input
                type="checkbox"
                checked={Boolean(field.inline)}
                onChange={(e) => updateField(index, { inline: e.target.checked })}
                className="h-3 w-3 accent-accent"
              />
              inline
            </label>
            <button
              type="button"
              onClick={() => removeField(index)}
              aria-label={`Remove field ${index + 1}`}
              className="flex h-8 w-7 items-center justify-center border border-border text-text-dim hover:text-offline"
            >
              <TrashIcon width={13} height={13} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Discord-style preview ──

function DiscordPreview({
  embed,
  vars,
}: {
  embed: DiscordEmbed;
  vars: Record<string, string | number>;
}) {
  const colorBar = useMemo(
    () => `#${(embed.color ?? 0x202225).toString(16).padStart(6, '0').slice(0, 6)}`,
    [embed.color],
  );

  const title = embed.title ? interpolate(embed.title, vars) : '';
  const description = embed.description ? interpolate(embed.description, vars) : '';
  const authorName = embed.author?.name ? interpolate(embed.author.name, vars) : '';
  const authorIcon = embed.author?.icon_url
    ? interpolate(embed.author.icon_url, vars)
    : '';
  const thumbUrl = embed.thumbnail?.url ? interpolate(embed.thumbnail.url, vars) : '';
  const footerText = embed.footer?.text ? interpolate(embed.footer.text, vars) : '';
  const fields = (embed.fields ?? []).map((field) => ({
    name: interpolate(field.name, vars),
    value: interpolate(field.value, vars),
    inline: Boolean(field.inline),
  }));
  const timestamp = embed.timestamp ? new Date().toLocaleString() : '';
  const footerLine = [footerText, timestamp].filter(Boolean).join(' • ');

  const inlineFields = fields.filter((f) => f.inline);
  const blockFields = fields.filter((f) => !f.inline);

  return (
    <div className="bg-[#36393f] p-3 text-[#dcddde]">
      <div className="flex">
        <div
          className="w-1 shrink-0"
          style={{ backgroundColor: colorBar, borderRadius: 2 }}
        />
        <div className="flex min-w-0 flex-1 gap-3 bg-[#2f3136] p-3">
          <div className="min-w-0 flex-1 space-y-2">
            {(authorName || authorIcon) && (
              <div className="flex items-center gap-2 text-[12px] font-medium">
                {authorIcon && (
                  <img
                    src={authorIcon}
                    alt=""
                    className="h-5 w-5 rounded-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <span>{authorName}</span>
              </div>
            )}
            {title && (
              <div className="text-[15px] font-semibold text-white">{title}</div>
            )}
            {description && (
              <div className="whitespace-pre-wrap break-words text-[14px] leading-snug">
                {description}
              </div>
            )}

            {inlineFields.length > 0 && (
              <div className="grid grid-cols-3 gap-3 pt-1">
                {inlineFields.map((field, i) => (
                  <div key={i} className="min-w-0">
                    <div className="text-[12px] font-semibold text-white">
                      {field.name}
                    </div>
                    <div className="break-words text-[13px] text-[#dcddde]">
                      {field.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {blockFields.map((field, i) => (
              <div key={`b${i}`} className="pt-1">
                <div className="text-[12px] font-semibold text-white">{field.name}</div>
                <div className="whitespace-pre-wrap break-words text-[13px] text-[#dcddde]">
                  {field.value}
                </div>
              </div>
            ))}

            {footerLine && (
              <div className="pt-2 text-[11px] text-[#a3a6aa]">{footerLine}</div>
            )}
          </div>

          {thumbUrl && (
            <img
              src={thumbUrl}
              alt=""
              className="h-20 w-20 shrink-0 rounded object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── small primitives ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </label>
  );
}
