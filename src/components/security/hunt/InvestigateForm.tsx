import React, { useState } from 'react';
import { Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { SegmentedControl } from '@gen3/frontend';
import { IconSearch } from '@tabler/icons-react';
import type { EntitySeed } from '@/lib/vectis-kit/spec';
import { MAX_VALUE_LENGTH, guessEntityType } from '@/lib/vectis-kit/spec/indicator';
import { ENTITY_INPUT_LABEL, ENTITY_INPUT_TYPES, validateEntityInput } from '../entities/entityKeys';
import { DEFAULT_SPAN, LAST_ACTIVITY, SPANS, fromLocalInput, toLocalInput } from './contextModel';
import type { ContextSpec, Scope } from './contextModel';
import { validateAlertId } from './huntModel';

const ALERT = 'alert';
// An identity is not looked up here (the answer itself would be the leak) and a STIX pattern is turned into its value by the entity form, not here.
const TYPE_OPTIONS = [
  ...ENTITY_INPUT_TYPES.filter((t) => t !== 'user').map((t) => ({ value: t, label: ENTITY_INPUT_LABEL[t] ?? t })),
  { value: ALERT, label: 'Alert id' },
];
const KNOWN_TYPES = new Set(TYPE_OPTIONS.map((o) => o.value));

type When = 'last' | 'now' | 'pick';
/** Where to look: the entity's last activity (the default: an entity is usually looked up because of something it did), right now, or a chosen moment. */
const WHEN_OPTIONS = [{ value: 'last', label: 'Last activity' }, { value: 'now', label: 'Now' }, { value: 'pick', label: 'Pick a time' }];

/** An alert group id is 24 hex characters. Nothing else is: an address, a domain, an ARN or a path never looks like one. */
export const looksLikeAlertId = (v: string): boolean => /^[0-9a-f]{24}$/i.test(v.trim());

/** What a pasted value is, so nobody has to say. A value the entity types cannot hold keeps whatever was chosen. */
export function detectType(raw: string, fallback: string): string {
  const v = raw.trim();
  if (v === '') return fallback;
  if (looksLikeAlertId(v)) return ALERT;
  if (v.startsWith('arn:')) return 'arn';
  const guessed = guessEntityType(v);
  return KNOWN_TYPES.has(guessed) ? guessed : fallback;
}

export interface Start { seed: EntitySeed; at: string; span: number; scope: Scope }

/**
 * The one place to start a hunt: paste anything (an address, a domain, an ARN, a hash, a path, a session, an alert id) and say when to look.
 * The kind is detected as you type and can be changed. Span and scope change the current investigation at once; a new entity or moment is
 * applied with the button.
 */
export const InvestigateForm = ({ current, onChange, onStart, onAlert }: {
  current: ContextSpec | null;
  onChange: (spec: ContextSpec | null) => void;
  onStart: (start: Start) => void;
  onAlert: (groupId: string) => void;
}) => {
  const [type, setType] = useState<string>(current?.seed.type ?? 'ip');
  const [picked, setPicked] = useState(false); // the kind was chosen by hand: stop guessing
  const [value, setValue] = useState(current?.seed.value ?? '');
  const [when, setWhen] = useState<When>(current ? 'pick' : 'last');
  const [at, setAt] = useState(toLocalInput(current?.at ?? new Date().toISOString()));
  const [error, setError] = useState<string | null>(null);

  const typeValue = (v: string) => {
    setValue(v);
    setError(null);
    if (!picked) setType((t) => detectType(v, t));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (type === ALERT) {
      const bad = validateAlertId(value.trim());
      if (bad !== null) { setError(bad); return; }
      setError(null);
      onAlert(value.trim());
      return;
    }
    const checked = validateEntityInput(type, value);
    if ('error' in checked) { setError(checked.error); return; }
    let moment: string = LAST_ACTIVITY;
    if (when === 'now') moment = new Date().toISOString();
    if (when === 'pick') {
      const iso = fromLocalInput(at);
      if (iso === null) { setError('Choose the moment to look at.'); return; }
      moment = iso;
    }
    setError(null);
    onStart({ seed: checked.seed, at: moment, span: current?.span ?? DEFAULT_SPAN, scope: current?.scope ?? 'actor' });
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <form onSubmit={submit} noValidate aria-label="Start an investigation">
          <Group align="flex-start" gap="sm" wrap="wrap">
            <Select aria-label="Follow" size="md" data={TYPE_OPTIONS} value={type} allowDeselect={false} w={150}
              onChange={(v) => { if (v) { setType(v); setPicked(true); setError(null); } }} />
            <TextInput aria-label="Entity value" size="md" leftSection={<IconSearch size={16} />} error={error} spellCheck={false} autoFocus={!current}
              placeholder="Paste an address, domain, ARN, hash, path, session or alert id" value={value} maxLength={MAX_VALUE_LENGTH + 1}
              onChange={(e) => typeValue(e.currentTarget.value)} style={{ flex: 1, minWidth: 280 }} />
            <Button type="submit" size="md">Investigate</Button>
          </Group>
        </form>
        <Group align="center" gap="lg" wrap="wrap">
          {type === ALERT ? null : (
            <Group gap="xs" align="center">
              <Text size="sm" c="dimmed" id="inv-when-label">Look at</Text>
              <SegmentedControl padding={2} size="xs" aria-labelledby="inv-when-label" value={when} onChange={(v) => setWhen(v as When)} data={WHEN_OPTIONS} />
              {when === 'pick' ? <TextInput aria-label="At (your local time)" size="xs" type="datetime-local" step={1} value={at} onChange={(e) => { setAt(e.currentTarget.value); setError(null); }} w={210} /> : null}
            </Group>
          )}
          {current ? (
            <>
              <Group gap="xs" align="center">
                <Text size="sm" c="dimmed" id="inv-scope-label">Show events for</Text>
                <SegmentedControl padding={2} size="xs" aria-labelledby="inv-scope-label" value={current.scope}
                  onChange={(v) => onChange({ ...current, scope: v as Scope })}
                  data={[{ value: 'actor', label: 'This entity' }, { value: 'all', label: 'Everything' }]} />
              </Group>
              <Select size="xs" label="Reach each way" w={170} allowDeselect={false} value={String(current.span)}
                onChange={(v) => { if (v) onChange({ ...current, span: Number(v) }); }}
                styles={{ root: { display: 'flex', alignItems: 'center', gap: 8 }, label: { whiteSpace: 'nowrap', margin: 0 } }}
                data={SPANS.map((m) => ({ value: String(m), label: m === 60 ? '1 hour' : m === 120 ? '2 hours' : `${m} minute${m === 1 ? '' : 's'}` }))} />
              <Button size="xs" variant="subtle" color="gray" onClick={() => onChange(null)}>Clear</Button>
            </>
          ) : null}
        </Group>
        {current ? null : (
          <Text size="xs" c="dimmed">You get what it did just before and just after, who else acts like it, and what the graph knows about it. Click any value in the events to hunt on that instead.</Text>
        )}
      </Stack>
    </Paper>
  );
};
