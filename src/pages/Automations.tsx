import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { Modal } from '../components/Modal';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { invoke, on, tryInvoke } from '../lib/ipc';
import type {
  Automation,
  AutomationAction,
  AutomationCondition,
  AutomationEventType,
  AutomationTestResult,
} from '../lib/types';

const EVENT_TYPES: AutomationEventType[] = [
  'follow',
  'subscription',
  'sub_gift',
  'cheer',
  'raid',
  'stream_online',
  'stream_offline',
];

const OPERATORS: AutomationCondition['operator'][] = [
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'contains',
  'not_contains',
];

const FIELD_BY_EVENT: Record<AutomationEventType, string[]> = {
  follow: [],
  subscription: ['tier', 'isGift'],
  sub_gift: ['total', 'tier'],
  cheer: ['bits'],
  raid: ['viewer_count'],
  stream_online: [],
  stream_offline: [],
};

type EditorState = { mode: 'create' | 'edit'; automation?: Automation };

export function Automations() {
  const confirm = useConfirm();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await tryInvoke<Automation[]>('automations:list');
    if (res.success) setAutomations(res.data);
    else setError(res.error);
  }, []);

  useEffect(() => {
    void refresh();
    const off = on('automations:triggered', () => {
      void refresh();
    });
    return off;
  }, [refresh]);

  const toggle = async (automation: Automation) => {
    await invoke('automations:toggle', automation.id);
    await refresh();
  };

  const remove = async (automation: Automation) => {
    const ok = await confirm({
      title: 'Delete automation',
      message: (
        <>
          Permanently delete <span className="font-mono text-text">{automation.name}</span>?
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await invoke('automations:delete', automation.id);
    await refresh();
  };

  const save = async (input: AutomationInputShape) => {
    if (input.id) await invoke('automations:update', input);
    else await invoke('automations:create', input);
    setEditor(null);
    await refresh();
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-text">
            Automations
          </h2>
          <p className="text-xs text-text-dim">
            Event-triggered actions with conditions, cooldowns, and previews.
          </p>
        </div>
        <button
          onClick={() => setEditor({ mode: 'create' })}
          disabled={automations.length >= 20}
          className="flex items-center gap-2 border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          <PlusIcon width={14} height={14} />
          New Automation
        </button>
      </div>

      {error && (
        <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        {automations.map((automation) => (
          <div
            key={automation.id}
            className="grid cursor-pointer grid-cols-[1fr_140px_120px_60px_40px] items-center gap-4 border border-border bg-bg-panel px-4 py-3 hover:bg-bg-hover"
            onClick={() => setEditor({ mode: 'edit', automation })}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text">
                {automation.name}
              </div>
              <div className="truncate text-xs text-text-dim">
                {automation.conditions.length} conditions, {automation.actions.length} actions
              </div>
            </div>
            <div className="font-mono text-xs text-text-muted">
              {automation.event_type}
            </div>
            <div className="font-mono text-xs text-text-muted">
              {automation.last_triggered_at
                ? new Date(automation.last_triggered_at * 1000).toLocaleString()
                : 'never'}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle
                value={automation.enabled}
                onChange={() => {
                  void toggle(automation);
                }}
              />
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void remove(automation);
              }}
              className="text-text-dim hover:text-offline"
              aria-label={`Delete ${automation.name}`}
            >
              <TrashIcon width={14} height={14} />
            </button>
          </div>
        ))}
        {automations.length === 0 && (
          <div className="border border-border bg-bg-panel px-6 py-16 text-center text-sm text-text-dim">
            No automations yet.
          </div>
        )}
      </div>

      {editor && (
        <AutomationEditor
          mode={editor.mode}
          automation={editor.automation}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

interface AutomationInputShape {
  id?: number;
  name: string;
  enabled: boolean;
  event_type: AutomationEventType;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  cooldown_seconds: number;
}

function AutomationEditor({
  mode,
  automation,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit';
  automation?: Automation;
  onClose: () => void;
  onSave: (input: AutomationInputShape) => Promise<void>;
}) {
  const [name, setName] = useState(automation?.name ?? '');
  const [eventType, setEventType] = useState<AutomationEventType>(
    automation?.event_type ?? 'follow',
  );
  const [conditions, setConditions] = useState<AutomationCondition[]>(
    automation?.conditions ?? [],
  );
  const [actions, setActions] = useState<AutomationAction[]>(
    automation?.actions ?? [{ type: 'send_chat_message', message: 'Thanks {user}!' }],
  );
  const [cooldown, setCooldown] = useState(automation?.cooldown_seconds ?? 0);
  const [enabled, setEnabled] = useState(automation?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AutomationTestResult | null>(null);

  const fields = useMemo(() => FIELD_BY_EVENT[eventType], [eventType]);

  const save = async () => {
    setError(null);
    try {
      await onSave({
        id: automation?.id,
        name,
        enabled,
        event_type: eventType,
        conditions,
        actions,
        cooldown_seconds: cooldown,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const test = async () => {
    setError(null);
    try {
      const result = await invoke<AutomationTestResult>('automations:test', {
        name: name || 'Test automation',
        enabled,
        event_type: eventType,
        conditions,
        actions,
        cooldown_seconds: cooldown,
      });
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed.');
    }
  };

  return (
    <Modal
      title={mode === 'create' ? 'New Automation' : `Edit ${automation?.name}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={() => {
              void test();
            }}
            className="border border-border bg-bg-panel px-3 py-1.5 text-xs uppercase tracking-wider text-text-muted hover:bg-bg-hover"
          >
            Test
          </button>
          <button
            onClick={onClose}
            className="border border-border bg-bg-panel px-3 py-1.5 text-xs uppercase tracking-wider text-text-muted hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void save();
            }}
            disabled={!name.trim() || actions.length === 0}
            className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            Save
          </button>
        </>
      }
    >
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        {error && (
          <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
            {error}
          </div>
        )}

        <div className="grid grid-cols-[1fr_180px] gap-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
            />
          </Field>
          <Field label="Event">
            <select
              value={eventType}
              onChange={(e) => {
                setEventType(e.target.value as AutomationEventType);
                setConditions([]);
              }}
              className="w-full border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
            >
              {EVENT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <SectionTitle title="Conditions" />
        <div className="space-y-2">
          {conditions.map((condition, index) => (
            <div key={index} className="grid grid-cols-[1fr_140px_1fr_28px] gap-2">
              <select
                value={condition.field}
                onChange={(e) => updateCondition(index, { field: e.target.value })}
                className="border border-border bg-bg px-2 py-1.5 text-xs text-text"
              >
                {fields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
              <select
                value={condition.operator}
                onChange={(e) =>
                  updateCondition(index, {
                    operator: e.target.value as AutomationCondition['operator'],
                  })
                }
                className="border border-border bg-bg px-2 py-1.5 text-xs text-text"
              >
                {OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>
              <input
                value={condition.value}
                onChange={(e) => updateCondition(index, { value: e.target.value })}
                className="border border-border bg-bg px-2 py-1.5 text-xs text-text"
              />
              <IconButton onClick={() => removeCondition(index)} label="Remove condition" />
            </div>
          ))}
          <button
            type="button"
            onClick={() => addCondition(fields[0])}
            disabled={fields.length === 0}
            className="border border-border bg-bg px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted hover:bg-bg-hover disabled:opacity-50"
          >
            Add condition
          </button>
        </div>

        <SectionTitle title="Actions" />
        <div className="space-y-3">
          {actions.map((action, index) => (
            <ActionEditor
              key={index}
              action={action}
              index={index}
              onChange={(next) => updateAction(index, next)}
              onRemove={() => removeAction(index)}
              onMove={(direction) => moveAction(index, direction)}
            />
          ))}
          <button
            type="button"
            onClick={() => addAction()}
            disabled={actions.length >= 10}
            className="border border-border bg-bg px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted hover:bg-bg-hover disabled:opacity-50"
          >
            Add action
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cooldown seconds">
            <input
              type="number"
              min={0}
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
            />
          </Field>
          <label className="flex items-end gap-2 pb-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            Enabled
          </label>
        </div>

        {testResult && (
          <div className="border border-border bg-bg px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim">
              {testResult.matched ? 'matched' : testResult.skippedReason}
            </div>
            {testResult.steps.map((step, index) => (
              <div key={index} className="mt-1 text-xs text-text-muted">
                <span className="font-mono text-text">{step.action}</span>: {step.detail}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );

  function addCondition(field?: string) {
    if (!field) return;
    setConditions((prev) => [
      ...prev,
      { field, operator: 'equals', value: '' },
    ]);
  }

  function updateCondition(index: number, patch: Partial<AutomationCondition>) {
    setConditions((prev) =>
      prev.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)),
    );
  }

  function removeCondition(index: number) {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }

  function addAction() {
    setActions((prev) => [...prev, { type: 'send_chat_message', message: '' }]);
  }

  function updateAction(index: number, next: AutomationAction) {
    setActions((prev) => prev.map((action, i) => (i === index ? next : action)));
  }

  function removeAction(index: number) {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }

  function moveAction(index: number, direction: -1 | 1) {
    setActions((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      if (!item) return prev;
      next.splice(target, 0, item);
      return next;
    });
  }
}

function ActionEditor({
  action,
  index,
  onChange,
  onRemove,
  onMove,
}: {
  action: AutomationAction;
  index: number;
  onChange: (action: AutomationAction) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div className="border border-border bg-bg p-3">
      <div className="mb-2 grid grid-cols-[1fr_28px_28px_28px] gap-2">
        <select
          value={action.type}
          onChange={(e) => onChange(defaultAction(e.target.value))}
          className="border border-border bg-bg-panel px-2 py-1.5 text-xs text-text"
        >
          <option value="send_chat_message">send_chat_message</option>
          <option value="play_sound">play_sound</option>
          <option value="send_discord_webhook">send_discord_webhook</option>
          <option value="timeout_user">timeout_user</option>
          <option value="add_exp">add_exp</option>
          <option value="delay">delay</option>
        </select>
        <SmallButton label="Up" onClick={() => onMove(-1)}>
          ^
        </SmallButton>
        <SmallButton label="Down" onClick={() => onMove(1)}>
          v
        </SmallButton>
        <IconButton onClick={onRemove} label={`Remove action ${index + 1}`} />
      </div>
      {renderActionFields(action, onChange)}
    </div>
  );
}

function renderActionFields(
  action: AutomationAction,
  onChange: (action: AutomationAction) => void,
) {
  switch (action.type) {
    case 'send_chat_message':
      return (
        <TextInput
          value={action.message}
          placeholder="Welcome {user}!"
          onChange={(message) => onChange({ ...action, message })}
        />
      );
    case 'play_sound':
      return (
        <TextInput
          value={action.file}
          placeholder="alert.mp3"
          onChange={(file) => onChange({ ...action, file })}
        />
      );
    case 'send_discord_webhook':
      return (
        <div className="grid grid-cols-[140px_1fr] gap-2">
          <TextInput
            value={action.webhook_key}
            placeholder="default"
            onChange={(webhook_key) => onChange({ ...action, webhook_key })}
          />
          <TextInput
            value={action.message ?? ''}
            placeholder="{user} triggered an event"
            onChange={(message) => onChange({ ...action, message })}
          />
        </div>
      );
    case 'timeout_user':
      return (
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <NumberInput
            value={action.duration}
            onChange={(duration) => onChange({ ...action, duration })}
          />
          <TextInput
            value={action.reason ?? ''}
            placeholder="Reason"
            onChange={(reason) => onChange({ ...action, reason })}
          />
        </div>
      );
    case 'add_exp':
      return (
        <NumberInput
          value={action.amount}
          onChange={(amount) => onChange({ ...action, amount })}
        />
      );
    case 'delay':
      return (
        <NumberInput
          value={action.seconds}
          max={30}
          onChange={(seconds) => onChange({ ...action, seconds })}
        />
      );
  }
}

function defaultAction(type: string): AutomationAction {
  switch (type) {
    case 'play_sound':
      return { type, file: '' };
    case 'send_discord_webhook':
      return { type, webhook_key: 'default', message: '' };
    case 'timeout_user':
      return { type, duration: 60, reason: 'Automation' };
    case 'add_exp':
      return { type, amount: 100 };
    case 'delay':
      return { type, seconds: 5 };
    default:
      return { type: 'send_chat_message', message: '' };
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="border-b border-border pb-1 font-mono text-[10px] uppercase tracking-wider text-text-dim">
      {title}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-border bg-bg-panel px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
    />
  );
}

function NumberInput({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <input
      type="number"
      min={0}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full border border-border bg-bg-panel px-2 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
    />
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative h-4 w-8 border transition-colors ${
        value ? 'border-accent bg-accent/30' : 'border-border bg-bg'
      }`}
      aria-pressed={value}
    >
      <span
        className={`absolute top-0.5 h-2.5 w-2.5 transition-all ${
          value ? 'left-[18px] bg-accent' : 'left-0.5 bg-text-dim'
        }`}
      />
    </button>
  );
}

function IconButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-7 items-center justify-center border border-border text-text-dim hover:text-offline"
      aria-label={label}
    >
      <TrashIcon width={13} height={13} />
    </button>
  );
}

function SmallButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="h-8 border border-border font-mono text-xs text-text-dim hover:bg-bg-hover hover:text-text"
    >
      {children}
    </button>
  );
}
