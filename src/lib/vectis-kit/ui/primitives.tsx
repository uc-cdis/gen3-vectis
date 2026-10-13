import React from 'react';
import { ActionIcon, Anchor, Badge, Button, CopyButton, Group, Paper, Skeleton, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
// Reuse the framework's message components rather than restyling our own.
import { ErrorCard, MessageCard } from '@gen3/frontend';
import type { QueryState } from '@/lib/vectis-kit/api/hooks';
import type {
  DetectorTier, EntityType, Severity, TriageStatus} from '@/lib/vectis-kit/spec';
import { SEVERITY_COLOR, SEVERITY_LABEL, STATUS_LABEL, TIER_LABEL
} from '@/lib/vectis-kit/spec';
import { useSecurity } from '@/components/security/context';

export const SeverityBadge = ({ severity }: { severity: Severity }) => (
  <Badge color={SEVERITY_COLOR[severity]} variant="filled" radius="sm" size="sm">{SEVERITY_LABEL[severity]}</Badge>
);

export const StatusBadge = ({ status }: { status: TriageStatus }) => (
  <Badge color={status === 'new' ? 'blue' : status === 'noise' ? 'gray' : status === 'resolved' ? 'green' : 'violet'} variant="light" radius="sm" size="sm">
    {STATUS_LABEL[status]}
  </Badge>
);

export const TierBadge = ({ tier }: { tier: DetectorTier }) => (
  <Badge color="gray" variant="outline" radius="sm" size="sm">{TIER_LABEL[tier]}</Badge>
);

/** Anything not yet computed renders as this, never as zero or blank. */
export const Unmeasured = ({ reason }: { reason?: string }) => (
  <Tooltip label={reason ?? 'Not computed yet. This is not zero.'} withArrow>
    <Text component="span" size="sm" c="dimmed" fs="italic" data-testid="unmeasured">Unmeasured</Text>
  </Tooltip>
);

/** The one way an entity value is shown anywhere in the console. Click opens the entity drawer. */
export const EntityLink = ({ type, value, children }: { type: EntityType; value: string; children?: React.ReactNode }) => {
  const { openEntity } = useSecurity();
  return (
    <Anchor component="button" type="button" size="sm" ff="monospace" onClick={() => openEntity({ type, value })} title={`Open ${type} ${value}`}>
      {children ?? value}
    </Anchor>
  );
};

/** What an error is called for each client: the words that depend on which service failed. */
export interface ErrorWording { noAccess: string; unreachable: string; serverError?: string }
export const SERVICE_ERRORS: ErrorWording = {
  noAccess: 'You do not have access to this data. Ask an administrator if you need it.',
  unreachable: 'The security service could not be reached. Nothing is wrong with your query.',
};

export function describeError(e: { status: number; message: string }, w: ErrorWording = SERVICE_ERRORS): { title: string; message: string; retry: boolean } {
  if (e.status === 401) return { title: 'Sign in required', message: 'Your session has expired. Sign in again to continue.', retry: false };
  if (e.status === 403) return { title: 'No access', message: w.noAccess, retry: false };
  if (e.status === 0) return { title: 'Service unavailable', message: w.unreachable, retry: true };
  if (e.status === 412) return { title: 'Changed by someone else', message: e.message, retry: true };
  if (e.status >= 500 && w.serverError) return { title: 'Something went wrong', message: w.serverError, retry: true };
  return { title: 'Something went wrong', message: e.message, retry: true };
}

export const ErrorState = ({ error, onRetry, wording }: { error: { status: number; message: string }; onRetry?: () => void; wording?: ErrorWording }) => {
  const d = describeError(error, wording);
  return (
    <div role="alert" data-testid="error-state">
      <ErrorCard message={`${d.title}. ${d.message}`} />
      {d.retry && onRetry ? <Button mt="xs" size="xs" variant="default" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
};

/** A small copy-to-clipboard icon button. `what` names the thing for the tooltip and screen readers ("raw key"). */
export const CopyIcon = ({ value, what }: { value: string; what: string }) => (
  <CopyButton value={value} timeout={1500}>
    {({ copied, copy }) => (
      <Tooltip label={copied ? 'Copied' : `Copy ${what}`} withArrow>
        <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} size="sm" onClick={copy} aria-label={`Copy ${what}`}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </ActionIcon>
      </Tooltip>
    )}
  </CopyButton>
);

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div data-testid="empty-state">
    <MessageCard message={hint ? `${title}. ${hint}` : title} />
  </div>
);

export const LoadingState = ({ rows = 4 }: { rows?: number }) => (
  <Stack gap="xs" aria-busy="true" aria-label="Loading" data-testid="loading-state">
    {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={34} radius="sm" />)}
  </Stack>
);

/**
 * Renders loading, error and empty states the same way everywhere. Children only ever see real data.
 * `isEmpty` lets a tab say what "nothing here" means for its data.
 */
export function QueryBoundary<T>({
  query, children, isEmpty, empty, rows,
}: {
  query: QueryState<T>;
  children: (data: T) => React.ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  rows?: number;
}) {
  if (query.error && query.data === undefined) return <ErrorState error={query.error} onRetry={() => void query.refresh()} />;
  if (query.data === undefined) return <LoadingState rows={rows} />;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState title="Nothing to show" />}</>;
  return (
    <>
      {query.error ? <ErrorState error={query.error} onRetry={() => void query.refresh()} /> : null}
      {children(query.data)}
    </>
  );
}

export const Panel = ({ title, action, dense = false, children }: { title?: React.ReactNode; action?: React.ReactNode; dense?: boolean; children: React.ReactNode }) => (
  <Paper withBorder p={dense ? 10 : 'md'} radius="md">
    {title || action ? (
      <Group justify="space-between" mb={dense ? 6 : 'sm'}>
        {typeof title === 'string' ? <Title order={dense ? 6 : 5}>{title}</Title> : title}
        {action}
      </Group>
    ) : null}
    {children}
  </Paper>
);
