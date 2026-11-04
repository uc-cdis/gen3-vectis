import React from 'react';
import { Text } from '@mantine/core';
import { parseTextMeta } from '@/lib/text-meta';
import { formatNumber } from '@/lib/vectis-kit/ui/format';

/** The row keys the column goes by: `text_meta` in the Data API, `textMeta` in the dictionary. */
export const TEXT_META_KEYS = ['text_meta', 'textMeta'] as const;

/** The column value of a row, whichever name it carries. */
export const textMetaOf = (row: Record<string, unknown>): unknown => {
  for (const k of TEXT_META_KEYS) if (Object.hasOwn(row, k) && row[k] !== null && row[k] !== undefined && row[k] !== '') return row[k];
  return null;
};

/**
 * What the writer changed in this row's text, in words: which fields were cut at the storage ceiling, had a secret redacted, or had hidden
 * characters shown as <U+XXXX>, with the original length and sha256. Absent when nothing was changed. A malformed value says `unreadable`.
 */
export const TextMetaNote = ({ value }: { value: unknown }): React.ReactElement | null => {
  const meta = parseTextMeta(value);
  if (meta.kind === 'none') return null;
  if (meta.kind === 'unreadable') {
    return <Text size="xs" c="dimmed" mt="xs" data-testid="text-meta-note">Stored-text record: unreadable.</Text>;
  }
  return (
    <div data-testid="text-meta-note" role="note" aria-label="Changes made to the stored text" style={{ marginTop: 8 }}>
      <Text size="xs" fw={600}>Stored text that was changed</Text>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {meta.fields.map((f, i) => {
          const what = [
            f.truncated ? 'cut at the storage limit' : null,
            f.redacted ? 'secret redacted' : null,
            f.hidden > 0 ? `${formatNumber(f.hidden)} hidden character${f.hidden === 1 ? '' : 's'} shown as <U+XXXX>` : null,
          ].filter((x): x is string => x !== null);
          return (
            <li key={`${f.field}#${i}`}>
              <Text span size="xs" style={{ overflowWrap: 'anywhere' }}>
                <Text span size="xs" ff="monospace">{f.field}</Text>: {what.length ? what.join(', ') : 'changed'}.{' '}
                Original {f.length === null ? 'length unknown' : `${formatNumber(f.length)} characters`}
                {f.sha256 ? <>, sha256 <Text span size="xs" ff="monospace">{f.sha256}</Text></> : ', sha256 not recorded'}
                {f.redacted && f.redactedSha256 ? <>; redacted sha256 <Text span size="xs" ff="monospace">{f.redactedSha256}</Text></> : null}
                .
              </Text>
            </li>
          );
        })}
      </ul>
      {meta.more > 0 ? <Text size="xs" c="dimmed">and {formatNumber(meta.more)} more fields.</Text> : null}
    </div>
  );
};
