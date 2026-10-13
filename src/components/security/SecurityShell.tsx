import React from 'react';
import { ActionIcon, Badge, Group, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { PanelErrorBoundary, SegmentedControl, WarningCard } from '@gen3/frontend';
import { SiemApiProvider, useSiemApi } from '@/lib/vectis-kit/api/hooks';
import type { SiemApi } from '@/lib/vectis-kit/api/client';
import type { RangeId, TabId} from './context';
import { RANGES, SECTIONS, SecurityProvider, TABS, useSecurity } from './context';
import type { SectionPath } from './context';
import AlertDrawer from './drawers/AlertDrawer';
import EntityDrawer from './drawers/EntityDrawer';
import AlertsTab from './tabs/AlertsTab';
import CasesTab from './tabs/CasesTab';
import CoverageTab from './tabs/CoverageTab';
import DataTab from './tabs/DataTab';
import EntitiesTab from './tabs/EntitiesTab';
import HealthTab from './tabs/HealthTab';
import HuntTab from './tabs/HuntTab';
import IntelTab from './tabs/IntelTab';
import OverviewTab from './tabs/OverviewTab';

const TAB_COMPONENTS: Record<TabId, React.ComponentType> = {
  overview: OverviewTab, alerts: AlertsTab, cases: CasesTab, hunt: HuntTab, data: DataTab,
  entities: EntitiesTab, intel: IntelTab, coverage: CoverageTab, health: HealthTab,
};

const ModeBanner = () => {
  const api = useSiemApi();
  if (api.mode !== 'fixtures') return null;
  return (
    <div data-testid="fixtures-banner">
      <WarningCard message="Development fixtures: this page is showing synthetic sample data, not your data. It is available only in development builds." />
    </div>
  );
};

const Inner = ({ section }: { section?: SectionPath }) => {
  const { tab, goTab, range, setRange, refresh, alertId, entity, openAlert, openEntity } = useSecurity();
  const Active = TAB_COMPONENTS[tab];
  const tabs = section ? TABS.filter((t) => (SECTIONS[section].tabs as readonly string[]).includes(t.id)) : TABS;
  return (
    <div className="w-full px-6 py-4" data-testid="security-shell">
      <Group justify="space-between" align="center" mb="xs">
        <Group gap="sm" align="baseline">
          <Title order={2}>{section ? SECTIONS[section].title : 'Security'}</Title>
          {section ? null : <Badge variant="light" color="gray" size="sm">{TABS.find((t) => t.id === tab)?.label}</Badge>}
        </Group>
        <Group gap="xs">
          <SegmentedControl padding={2}
            size="xs"
            aria-label="Time range"
            value={range}
            onChange={(v) => setRange(v as RangeId)}
            data={RANGES.map((r) => ({ value: r.id, label: r.id }))}
          />
          <Tooltip label="Refresh now" withArrow>
            <ActionIcon variant="default" aria-label="Refresh" onClick={refresh}><IconRefresh size={16} /></ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <ModeBanner />
      <Tabs value={tab} onChange={(v) => v && goTab(v as TabId)} keepMounted={false} variant="default">
        <Tabs.List mb="md" aria-label="Security sections" style={tabs.length > 1 ? undefined : { display: 'none' }}>
          {tabs.map((t) => <Tabs.Tab key={t.id} value={t.id}>{t.label}</Tabs.Tab>)}
        </Tabs.List>
        <Tabs.Panel value={tab}>
          <PanelErrorBoundary>
            <Active />
          </PanelErrorBoundary>
        </Tabs.Panel>
      </Tabs>
      {alertId ? <AlertDrawer groupId={alertId} onClose={() => openAlert(null)} /> : null}
      {entity ? <EntityDrawer seed={entity} onClose={() => openEntity(null)} /> : null}
      <Text size="xs" c="dimmed" mt="lg">Times are shown in your local time zone.</Text>
    </div>
  );
};

/** `api` is injectable for tests and the development page; production always uses the live API. */
const SecurityShell = ({ api, section }: { api?: SiemApi; section?: SectionPath }) => (
  <SiemApiProvider api={api}>
    <SecurityProvider section={section ? SECTIONS[section].tabs : undefined}>
      <Inner section={section} />
    </SecurityProvider>
  </SiemApiProvider>
);

export default SecurityShell;
