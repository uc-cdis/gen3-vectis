import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { GetServerSideProps } from 'next';
import Link from 'next/link';
import {
  NavPageLayout,
  NavPageLayoutProps,
  getNavPageLayoutPropsFromConfig,
} from '@gen3/frontend';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Modal,
  Group,
  Paper,
  Select,
  Stack,
  TextInput,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import dynamic from 'next/dynamic';
import { SIEM_DEFAULT_WORKSPACE_CONFIG } from '@/components/siem/siemWorkspaceDefaults';

const SiemWorkspace = dynamic(() => import('@/components/siem/SiemWorkspace'), {
  ssr: false,
});

const LOCAL_VIEWS_STORAGE_KEY = 'gen3-vectis-siem-local-views';
const RAW_VIEW_ID = 'raw-data';

const RAW_VIEW: SiemWorkspaceViewRecord = {
  id: RAW_VIEW_ID,
  title: 'Command Center',
  name: 'Command Center',
  description: 'Original editable Perspective workspace with all data, panels, and pivots available.',
  kind: 'raw',
  scope: 'shared',
  workspace: SIEM_DEFAULT_WORKSPACE_CONFIG as Record<string, unknown>,
  filters: {},
  owner: null,
  isDefault: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

type SiemWorkspaceViewRecord = {
  id: string;
  title: string;
  name?: string; // legacy field, may be absent on newer records
  description: string | null;
  kind: string;
  scope: string;
  workspace: Record<string, unknown>;
  filters: Record<string, unknown>;
  owner: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type SiemWorkspaceViewListResponse = {
  canWrite: boolean;
  currentUser: string | null;
  views: SiemWorkspaceViewRecord[];
};

type UnifiedEvent = {
  timestamp: string;
  eventType: 'WAF' | 'Audit' | 'Threat';
  severity: string;
  source: string;
  target: string;
  account: string;
  action: string;
};

type TimelineProps = NavPageLayoutProps & {
  rows: UnifiedEvent[];
  dataError: string | null;
};

const SecurityTimelinePage = ({ headerProps, footerProps, rows, dataError }: TimelineProps) => {
  const [views, setViews] = useState<SiemWorkspaceViewRecord[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [viewsError, setViewsError] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetToken, setResetToken] = useState(0);

  function handleResetWorkspace() {
    setSelectedViewId(RAW_VIEW_ID);
    setResetToken((value) => value + 1);
  }

  function readLocalViews(): SiemWorkspaceViewRecord[] {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(LOCAL_VIEWS_STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as SiemWorkspaceViewRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeLocalViews(nextViews: SiemWorkspaceViewRecord[]) {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LOCAL_VIEWS_STORAGE_KEY, JSON.stringify(nextViews));
  }

  useEffect(() => {
    let mounted = true;

    async function loadViews() {
      try {
        const response = await fetch('/siem/views', { method: 'GET' });
        const payload = (await response.json()) as SiemWorkspaceViewListResponse;
        if (!mounted) {
          return;
        }

        if (!response.ok) {
          throw new Error((payload as { error?: string }).error || 'Failed to load SIEM views');
        }

        const localViews = readLocalViews();
        const combinedViews = [
          RAW_VIEW,
          ...(payload.views || []),
          ...localViews.filter((view) => !(payload.views || []).some((remoteView) => remoteView.id === view.id)),
        ];
        setViews(combinedViews);
        setCanWrite(Boolean(payload.canWrite));
        setCurrentUser(payload.currentUser || null);
        setSelectedViewId((current) => current || RAW_VIEW_ID);
        setViewsError(null);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }

        setViewsError(error instanceof Error ? error.message : 'Failed to load SIEM views');
      }
    }

    loadViews();

    return () => {
      mounted = false;
    };
  }, []);

  const selectedView = useMemo(
    () => views.find((view) => view.id === selectedViewId) ?? views.find((view) => view.id === RAW_VIEW_ID) ?? views[0] ?? null,
    [selectedViewId, views],
  );

  useEffect(() => {
    if (selectedView) {
      setSaveName(selectedView.title || selectedView.name || '');
      setSaveDescription(selectedView.description || '');
    }
  }, [selectedView]);

  async function handleSaveView() {
    if (!selectedView) {
      return;
    }

    setSaving(true);
    try {
      if (!canWrite) {
        const localView: SiemWorkspaceViewRecord = {
          ...selectedView,
          id: `local-${Date.now()}`,
          title: saveName.trim(),
          name: saveName.trim(),
          description: saveDescription.trim() || null,
          scope: 'local',
          owner: currentUser,
          isDefault: false,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        const nextLocalViews = [...readLocalViews(), localView];
        writeLocalViews(nextLocalViews);
        setViews((current) => [...current, localView]);
        setSelectedViewId(localView.id);
        setSaveModalOpen(false);
        return;
      }

      const response = await fetch('/siem/views', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDescription.trim() || null,
          kind: selectedView.kind,
          scope: selectedView.scope,
          workspace: selectedView.workspace,
          filters: selectedView.filters,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || payload?.detail || 'Failed to save SIEM view');
      }

      setViews((current) => [...current, payload as SiemWorkspaceViewRecord]);
      setSelectedViewId((payload as SiemWorkspaceViewRecord).id);
      setSaveModalOpen(false);
      setViewsError(null);
    } catch (error: unknown) {
      setViewsError(error instanceof Error ? error.message : 'Failed to save SIEM view');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteView() {
    if (!selectedView || selectedView.isDefault) {
      return;
    }

    try {
      if (!canWrite || selectedView.scope === 'local') {
        const nextLocalViews = readLocalViews().filter((view) => view.id !== selectedView.id);
        writeLocalViews(nextLocalViews);
        setViews((current) => current.filter((view) => view.id !== selectedView.id));
        setSelectedViewId((current) => (current === selectedView.id ? views.find((view) => view.id !== selectedView.id)?.id || null : current));
        return;
      }

      const response = await fetch(`/siem/views/${encodeURIComponent(selectedView.id)}`, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || payload?.detail || 'Failed to delete SIEM view');
      }

      setViews((current) => current.filter((view) => view.id !== selectedView.id));
      setSelectedViewId((current) => (current === selectedView.id ? views.find((view) => view.id !== selectedView.id)?.id || null : current));
      setViewsError(null);
    } catch (error: unknown) {
      setViewsError(error instanceof Error ? error.message : 'Failed to delete SIEM view');
    }
  }

  return (
    <NavPageLayout
      {...{ headerProps, footerProps }}
      headerMetadata={{
        title: 'SIEM Timeline',
        content: 'Cross-Pivot Events',
        key: 'vectis-siem-timeline',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '12px 24px 8px' }}>
          <Paper withBorder radius="md" px="sm" py={8}>
            <Stack gap={4}>
              <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
                <div>
                  <Title order={3} fw={650} style={{ fontFamily: 'Poppins, sans-serif', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                    Unified Security Timeline
                  </Title>
                  <Text c="dimmed" size="xs" style={{ fontFamily: 'Poppins, sans-serif' }}>
                    Cross-pivot across WAF, Audit, and Threat events.
                  </Text>
                </div>
                <Group gap={6} wrap="wrap" align="center" justify="flex-end" style={{ maxWidth: '100%' }}>
                  <Select
                    value={selectedViewId}
                    onChange={setSelectedViewId}
                    data={views.map((view) => ({
                      value: view.id,
                      label: view.title ?? view.name,
                      description: view.description || undefined,
                    }))}
                    searchable
                    nothingFoundMessage="No saved views"
                    size="xs"
                    comboboxProps={{ width: 280, position: 'bottom-end' }}
                    style={{ width: 'min(280px, 65vw)' }}
                  />
                  <Button size="compact-xs" variant="light" onClick={() => setSaveModalOpen(true)} disabled={!selectedView}>
                    Save
                  </Button>
                  <Button size="compact-xs" variant="default" onClick={handleResetWorkspace} disabled={!views.length}>
                    Reset
                  </Button>
                  <Button size="compact-xs" variant="light" color="red" onClick={() => void handleDeleteView()} disabled={!selectedView || selectedView.isDefault}>
                    Delete
                  </Button>
                  <Badge variant="light" color={canWrite ? 'green' : 'gray'}>
                    {canWrite ? 'Writer' : 'Read only'}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    {rows.length.toLocaleString()} events
                  </Text>
                  <Link href="/SecurityDashboard">
                    <Button variant="default" size="xs" leftSection={<IconArrowLeft size={14} />}>
                      Dashboard
                    </Button>
                  </Link>
                </Group>
              </Group>

              {selectedView ? (
                <Text size="xs" c="dimmed">
                  {selectedView.description || 'Saved SIEM view'}
                  {currentUser && selectedView.owner === currentUser ? ' • owned by you' : ''}
                  {selectedView.isDefault ? ' • default preset' : ''}
                  {selectedView.scope === 'local' ? ' • local draft' : ''}
                </Text>
              ) : null}

              {viewsError ? (
                <Group>
                  <Alert color="yellow" title="Saved views failed to load" py={4} px="sm" style={{ maxWidth: 460 }}>
                    {viewsError}
                  </Alert>
                </Group>
              ) : null}
            </Stack>
          </Paper>
          {dataError ? (
            <Group mt="xs">
              <Alert color="red" title="Timeline data load failed" py={4} px="sm" style={{ maxWidth: 460 }}>
                {dataError}
              </Alert>
            </Group>
          ) : null}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <SiemWorkspace rows={rows} workspaceConfig={selectedView?.workspace} resetToken={resetToken} />
        </div>
      </div>

      <Modal opened={saveModalOpen} onClose={() => setSaveModalOpen(false)} title="Save SIEM view" centered>
        <Stack>
          <Text size="sm" c="dimmed">
            Save a copy of the currently selected view. Writers persist to the backend; everyone else keeps a local draft in the browser.
          </Text>
          <TextInput label="Name" value={saveName} onChange={(event) => setSaveName(event.currentTarget.value)} required />
          <Textarea label="Description" value={saveDescription} onChange={(event) => setSaveDescription(event.currentTarget.value)} minRows={3} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveView()} loading={saving} disabled={!saveName.trim()}>
              Save view
            </Button>
          </Group>
        </Stack>
      </Modal>
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<TimelineProps> = async (context) => {
  const baseProps = await getNavPageLayoutPropsFromConfig();

  const queryFilters: Record<string, string> = {};
  const allowedFilterFields = ['source', 'rule_id', 'user_country_name', 'event_source', 'target', 'account', 'action'];
  for (const field of allowedFilterFields) {
    const raw = context.query[field];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim()) {
      queryFilters[field] = value.trim();
    }
  }

  const siemBaseUrl = process.env.SIEM_SERVICE_URL
    ? process.env.SIEM_SERVICE_URL
    : process.env.SIEM_SERVICE_DNS
      ? `http://${process.env.SIEM_SERVICE_DNS}:8000`
      : 'http://siem-service.gen3.svc.cluster.local:8000';

  try {
    const cookieHeader = context.req.headers.cookie;
    const authHeader = context.req.headers.authorization;
    const response = await fetch(`${siemBaseUrl}/siem/timeline`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(typeof cookieHeader === 'string' ? { cookie: cookieHeader } : {}),
        ...(typeof authHeader === 'string' ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify({ page: { limit: 2000, offset: 0 }, filters: queryFilters }),
    });

    if (!response.ok) {
      throw new Error(`SIEM request failed: ${response.status}`);
    }

    const payload = await response.json();

    return {
      props: {
        ...baseProps,
        rows: payload?.rows || [],
        dataError: null,
      },
    };
  } catch (error: any) {
    return {
      props: {
        ...baseProps,
        rows: [],
        dataError: error?.message || 'Failed to load timeline data',
      },
    };
  }
};

export default SecurityTimelinePage;
