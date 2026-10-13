import React, { useState } from 'react';
import { Accordion, ActionIcon, Badge, Button, Checkbox, Group, NumberInput, ScrollArea, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { SegmentedControl } from '@gen3/frontend';
import type { ColumnMeta, FacetResult, FilterClause } from '@/lib/vectis-kit/spec';
import {
  clausesFor, enumSelection, filterKind, setBoolean, setEnumSelection, setRange, setText,
} from '@/lib/vectis-kit/data-table/filters';
import { Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { formatNumber } from '@/lib/vectis-kit/ui/format';

export interface FacetInfo { facet: FacetResult | undefined; loading: boolean; failed: boolean; notes?: string[] }

const PiiBadge = () => (
  <Badge size="xs" color="red" variant="outline" radius="sm" title="Personal data. What you can see is decided by your permissions.">PII</Badge>
);

const EnumFilter = ({ col, clauses, info, onChange }: { col: ColumnMeta; clauses: FilterClause[]; info: FacetInfo; onChange: (next: FilterClause[]) => void }) => {
  const selected = enumSelection(clauses, col.name);
  const counts = new Map((info.facet?.buckets ?? []).map((b) => [b.key, b.count]));
  const approximate = info.facet?.approximate === true;
  const keys = [...new Set([
    ...(info.facet?.buckets ?? []).map((b) => b.key),
    ...(col.enum_values ?? []),
    ...selected,
  ])];
  return (
    <Stack gap={4}>
      {info.facet === undefined ? (
        <Text size="xs" c="gray.7">{info.loading ? 'Loading counts…' : 'Counts: '}{info.loading ? null : <Unmeasured reason="Counts are not available for this field right now." />}</Text>
      ) : approximate && counts.size > 0 ? (
        <Text size="xs" c="gray.7">Counts are approximate (marked ~).</Text>
      ) : null}
      <ScrollArea.Autosize mah={220} type="auto">
        <Checkbox.Group value={selected} onChange={(v) => onChange(setEnumSelection(clauses, col.name, v))} aria-label={`${col.label} values`}>
          <Stack gap={4}>
            {keys.map((k) => (
              <Checkbox
                key={k}
                value={k}
                size="xs"
                label={
                  <Group gap={6} wrap="nowrap">
                    <span>{k === '' ? '(empty)' : k}</span>
                    {counts.has(k) ? <Text span size="xs" c="gray.7" title={approximate ? 'Approximate count' : 'Count'}>{approximate ? '~' : ''}{formatNumber(counts.get(k))}</Text> : null}
                  </Group>
                }
              />
            ))}
          </Stack>
        </Checkbox.Group>
      </ScrollArea.Autosize>
    </Stack>
  );
};

const RangeFilter = ({ col, clauses, onChange }: { col: ColumnMeta; clauses: FilterClause[]; onChange: (next: FilterClause[]) => void }) => {
  const cur = clausesFor(clauses, col.name);
  const initial = (op: 'gte' | 'lte') => { const c = cur.find((x) => x.op === op); return c ? Number(c.value) : ''; };
  const [min, setMin] = useState<number | string>(initial('gte'));
  const [max, setMax] = useState<number | string>(initial('lte'));
  const [error, setError] = useState<string | null>(null);
  const num = (v: number | string) => (v === '' ? null : Number(v));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const r = setRange(clauses, col.name, num(min), num(max));
        setError(r.error);
        if (!r.error) onChange(r.clauses);
      }}
    >
      <Stack gap={6}>
        <Group gap="xs" grow>
          <NumberInput size="xs" label="Minimum" value={min} onChange={setMin} allowDecimal={col.type === 'float'} hideControls aria-label={`${col.label} minimum`} />
          <NumberInput size="xs" label="Maximum" value={max} onChange={setMax} allowDecimal={col.type === 'float'} hideControls aria-label={`${col.label} maximum`} />
        </Group>
        {error ? <Text size="xs" c="red" role="alert">{error}</Text> : null}
        <Button type="submit" size="compact-xs" variant="default" aria-label={`Apply ${col.label} range`}>Apply range</Button>
      </Stack>
    </form>
  );
};

const TextFilter = ({ col, clauses, onChange }: { col: ColumnMeta; clauses: FilterClause[]; onChange: (next: FilterClause[]) => void }) => {
  const cur = clausesFor(clauses, col.name).find((c) => c.op === 'contains' || c.op === 'eq');
  const [text, setTextValue] = useState(cur ? String(cur.value) : '');
  const [op, setOp] = useState<'contains' | 'eq'>(cur?.op === 'eq' ? 'eq' : 'contains');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange(setText(clauses, col.name, op, text));
      }}
    >
      <Stack gap={6}>
        <Select size="xs" aria-label={`${col.label} match type`} value={op} onChange={(v) => setOp(v === 'eq' ? 'eq' : 'contains')} allowDeselect={false} data={[{ value: 'contains', label: 'contains' }, { value: 'eq', label: 'equals' }]} />
        <TextInput size="xs" aria-label={`${col.label} value`} placeholder={col.type === 'ip' ? 'e.g. a full address' : 'text to match'} value={text} maxLength={512} onChange={(e) => setTextValue(e.currentTarget.value)} />
        <Button type="submit" size="compact-xs" variant="default" aria-label={`Apply ${col.label} filter`}>Apply</Button>
      </Stack>
    </form>
  );
};

const BooleanFilter = ({ col, clauses, onChange }: { col: ColumnMeta; clauses: FilterClause[]; onChange: (next: FilterClause[]) => void }) => {
  const cur = clausesFor(clauses, col.name).find((c) => c.op === 'eq');
  const value = typeof cur?.value === 'boolean' ? String(cur.value) : 'any';
  return (
    <SegmentedControl padding={2}
      size="xs"
      aria-label={`${col.label} filter`}
      value={value}
      onChange={(v) => onChange(setBoolean(clauses, col.name, v === 'any' ? null : v === 'true'))}
      data={[{ value: 'any', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
    />
  );
};

/** How many filters are listed before "Show all". The rest are one click away, and search reaches all of them. */
const INITIAL_FILTERS = 8;
const OPEN_BY_DEFAULT = 3;
const HASHISH = /(^|_)hash$|^hash_|_hash_/;

/**
 * Most useful first: columns shown by default and enum-typed columns (a few values to pick from), then the other
 * structured ones, then free-text columns, then hash columns, which are rarely the way in. Catalog order breaks ties.
 */
function rankFilters(columns: readonly ColumnMeta[]): ColumnMeta[] {
  const kindRank = (c: ColumnMeta) => ({ enum: 0, boolean: 1, range: 2, text: 3, time: 4 } as Record<string, number>)[filterKind(c) ?? 'text'] ?? 3;
  const group = (c: ColumnMeta) => (HASHISH.test(c.name) ? 3 : filterKind(c) === 'text' ? (c.default_visible ? 1 : 2) : c.default_visible || filterKind(c) === 'enum' ? 0 : 1);
  return columns
    .map((c, i) => ({ c, i }))
    .sort((x, y) => group(x.c) - group(y.c) || kindRank(x.c) - kindRank(y.c) || Number(Boolean(y.c.default_visible)) - Number(Boolean(x.c.default_visible)) || x.i - y.i)
    .map((x) => x.c);
}

/** Filters generated from the catalog: enum -> checkboxes with counts, numbers -> range, text and addresses -> match. */
export const FilterPanel = ({
  columns, clauses, facets, onChange,
}: {
  columns: readonly ColumnMeta[];
  clauses: FilterClause[];
  facets: (field: string) => FacetInfo;
  onChange: (next: FilterClause[]) => void;
}) => {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const notes = [...new Set(columns.flatMap((c) => facets(c.name).notes ?? []))].slice(0, 2);
  const ordered = rankFilters(columns.filter((c) => filterKind(c) !== null && filterKind(c) !== 'time'));
  if (ordered.length === 0) return <Text size="sm" c="gray.7">This index has no filterable columns.</Text>;
  const q = query.trim().toLowerCase();
  const isActive = (c: ColumnMeta) => clausesFor(clauses, c.name).length > 0;
  const matches = q ? ordered.filter((c) => c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : null;
  // A filter that is applied is always listed, even beyond the cap: hiding it would hide why the table looks as it does.
  const listed = matches ?? (all ? ordered : ordered.filter((c, i) => i < INITIAL_FILTERS || isActive(c)));
  const openByDefault = ordered.filter((c) => filterKind(c) === 'enum').slice(0, OPEN_BY_DEFAULT).map((c) => c.name);
  return (
    <Stack gap="xs">
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--mantine-color-body)', paddingBottom: 6 }}>
        <TextInput
          size="xs" aria-label="Find a filter" placeholder={`Find a filter by name (${ordered.length})`} value={query}
          onChange={(e) => setQuery(e.currentTarget.value)} maxLength={64}
          rightSection={query ? <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Clear the filter search" onClick={() => setQuery('')}><IconX size={12} /></ActionIcon> : null}
        />
        <Text size="xs" c="gray.7" mt={4}>
          Time is set by the range at the top of the page.{notes.length > 0 ? ` ${notes.join(' ')}` : ''}
        </Text>
      </div>
      {listed.length === 0 ? <Text size="sm" c="gray.7" role="status">No filter is named like that.</Text> : (
        <Accordion multiple defaultValue={openByDefault} variant="separated" chevronPosition="left">
          {listed.map((col) => {
            const kind = filterKind(col);
            const active = clausesFor(clauses, col.name).length;
            return (
              <Accordion.Item key={col.name} value={col.name}>
                <Accordion.Control>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500}>{col.label}</Text>
                    {col.pii ? <PiiBadge /> : null}
                    {active > 0 ? <Badge size="xs" variant="filled" radius="sm" aria-label={`${active} active`}>{active}</Badge> : null}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {kind === 'enum' ? <EnumFilter col={col} clauses={clauses} info={facets(col.name)} onChange={onChange} /> : null}
                  {kind === 'range' ? <RangeFilter col={col} clauses={clauses} onChange={onChange} /> : null}
                  {kind === 'text' ? <TextFilter col={col} clauses={clauses} onChange={onChange} /> : null}
                  {kind === 'boolean' ? <BooleanFilter col={col} clauses={clauses} onChange={onChange} /> : null}
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}
      {!matches && ordered.length > INITIAL_FILTERS ? (
        <Button size="compact-sm" variant="subtle" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer filters' : `Show all ${ordered.length} filters`}
        </Button>
      ) : null}
    </Stack>
  );
};
