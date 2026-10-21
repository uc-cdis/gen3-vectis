import React from 'react';
import { Badge, Group, Stack, Text } from '@mantine/core';
import { useSiemQuery } from '../api/hooks';

/**
 * Where a record came from is never hidden: every alert and row names the AWS account (or source system), the deployment and
 * the feed that logged it. The names are a convenience read from the platform's account list; when that list is missing or
 * slow the bare id is shown, and an id the record does not carry is said to be "not recorded", never left blank.
 */
export function useAccountNames(): Record<string, string> {
  const q = useSiemQuery('accounts', {});
  return q.data?.accounts ?? {};
}

/** "Production platform (111122223333)", or just the id when it has no name, or a plain statement when there is none. */
export function accountText(account: string | null | undefined, names: Record<string, string>): string {
  if (!account) return 'Account not recorded';
  const name = names[account];
  return name && name !== account ? `${name} (${account})` : account;
}

export interface OriginFields {
  account?: string | null;
  accounts?: string[];
  environments?: string[];
  sources?: string[];
  hosts?: string[];
}

/** The account line, then the deployment and feed labels. `compact` drops the hosts (the table shows them in the drawer). */
export const OriginTags = ({ origin, compact = false }: { origin: OriginFields; compact?: boolean }) => {
  const names = useAccountNames();
  const accounts = origin.accounts?.length ? origin.accounts : origin.account ? [origin.account] : [];
  const environments = origin.environments ?? [];
  const sources = origin.sources ?? [];
  const hosts = compact ? [] : origin.hosts ?? [];
  return (
    <Stack gap={2} data-testid="origin-tags">
      {accounts.length
        ? accounts.map((a) => <Text key={a} size="xs" fw={600} title={a}>{accountText(a, names)}</Text>)
        : <Text size="xs" c="dimmed" fs="italic">{accountText(null, names)}</Text>}
      {environments.length || sources.length ? (
        <Group gap={4}>
          {environments.map((e) => <Badge key={`e:${e}`} size="xs" radius="sm" variant="light" color="grape" aria-label={`Environment ${e}`}>{e}</Badge>)}
          {sources.map((s) => <Badge key={`s:${s}`} size="xs" radius="sm" variant="outline" color="gray" aria-label={`Feed ${s}`}>{s}</Badge>)}
        </Group>
      ) : null}
      {hosts.length ? <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{hosts.join(', ')}</Text> : null}
    </Stack>
  );
};
