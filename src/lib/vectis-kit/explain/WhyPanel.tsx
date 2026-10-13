import React from 'react';
import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import type { WhyEvidence, WhySection } from '../spec';
import {
  BaselineSection, EvidenceSection, GraphSection, IndicatorSection, NoveltySection, RuleSection, SequenceSection, plainEntity,
} from './sections';
import type { RenderEntity } from './sections';

interface WhyPanelProps {
  sections: readonly WhySection[];
  /** Show entity values (addresses, indicators). Defaults to plain text. */
  renderEntity?: RenderEntity;
  /** Called when a section points at another alert. Omit to render those references as text. */
  onOpenAlert?: (groupId: string) => void;
  /** The plain-language summary, shown first. Written by fixed rules on the server, not by a model. */
  verdict?: string | null;
  /** What the alert's own events show (paths, actions, what could not be measured). */
  evidence?: WhyEvidence | null;
}

const KIND_LABEL: Record<string, string> = { rule: 'Rule', baseline: 'Baseline', sequence: 'Sequence', novelty: 'Novelty', indicator: 'Indicator', graph: 'Graph' };

/** One renderer per section kind. An unknown kind is shown as such, never silently dropped. */
export const WhyPanel = ({ sections, renderEntity = plainEntity, onOpenAlert, verdict, evidence }: WhyPanelProps) => {
  const ctx = { renderEntity, onOpenAlert };
  if (sections.length === 0 && !verdict && !evidence) return <Text size="sm" c="dimmed">No explanation was recorded for this alert.</Text>;
  const render = (s: WhySection, i: number) => {
    const kind = s.kind as string | undefined;
    let body: React.ReactNode;
    switch (kind) {
      case 'rule': body = <RuleSection s={s as Parameters<typeof RuleSection>[0]['s']} />; break;
      case 'baseline': body = <BaselineSection s={s as Parameters<typeof BaselineSection>[0]['s']} />; break;
      case 'sequence': body = <SequenceSection s={s as Parameters<typeof SequenceSection>[0]['s']} ctx={ctx} />; break;
      case 'novelty': body = <NoveltySection s={s as Parameters<typeof NoveltySection>[0]['s']} ctx={ctx} />; break;
      case 'indicator': body = <IndicatorSection s={s as Parameters<typeof IndicatorSection>[0]['s']} ctx={ctx} />; break;
      case 'graph': body = <GraphSection s={s as Parameters<typeof GraphSection>[0]['s']} />; break;
      default: body = <Text size="sm" c="dimmed">This kind of explanation is not supported by this version of the console.</Text>;
    }
    return (
      <Paper key={`${kind ?? 'unknown'}-${i}`} withBorder p="sm" radius="md" component="section" data-testid={`why-${kind ?? 'unknown'}`}>
        <Group justify="space-between" mb="xs">
          <Title order={6}>{s.title}</Title>
          <Badge variant="outline" color="gray" size="xs" radius="sm">{KIND_LABEL[kind ?? ''] ?? 'Unknown'}</Badge>
        </Group>
        {body}
      </Paper>
    );
  };
  // What fired, then what the events show, then the wider graph context.
  const lead = sections.filter((s) => s.kind !== 'graph');
  const graph = sections.filter((s) => s.kind === 'graph');
  return (
    <Stack gap="sm" aria-label="Why this fired">
      {verdict ? <Text size="sm" fw={500} data-testid="why-verdict" style={{ overflowWrap: 'anywhere' }}>{verdict}</Text> : null}
      {lead.map(render)}
      {evidence ? (
        <Paper withBorder p="sm" radius="md" component="section" data-testid="why-evidence">
          <Group justify="space-between" mb="xs">
            <Title order={6}>What the events show</Title>
            <Badge variant="outline" color="gray" size="xs" radius="sm">Evidence</Badge>
          </Group>
          <EvidenceSection e={evidence} />
        </Paper>
      ) : null}
      {graph.map((s, i) => render(s, lead.length + i))}
    </Stack>
  );
};
