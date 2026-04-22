import React from 'react';
import { GetServerSideProps } from 'next';
import Link from 'next/link';
import {
  NavPageLayout,
  NavPageLayoutProps,
  getNavPageLayoutPropsFromConfig,
} from '@gen3/frontend';
import {
  Alert,
  Button,
  Group,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import dynamic from 'next/dynamic';

const SiemWorkspace = dynamic(() => import('@/components/siem/SiemWorkspace'), {
  ssr: false,
});

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
        {/* Header strip */}
        <div style={{ flexShrink: 0, padding: '12px 24px 8px' }}>
          <Group justify="space-between" align="center">
            <div>
              <Title order={4} fw={600} style={{ fontFamily: 'Poppins, sans-serif', letterSpacing: '-0.01em' }}>Unified Security Timeline</Title>
              <Text c="dimmed" size="xs" style={{ fontFamily: 'Poppins, sans-serif' }}>Cross-pivot across WAF, Audit, and Threat events.</Text>
            </div>
            <Group gap="xs">
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
          {dataError ? (
            <Alert color="red" title="Timeline data load failed" mt="xs">
              {dataError}
            </Alert>
          ) : null}
        </div>

        {/* Workspace fills remaining viewport */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <SiemWorkspace rows={rows} />
        </div>
      </div>
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<TimelineProps> = async (context) => {
  const baseProps = await getNavPageLayoutPropsFromConfig();

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
      body: JSON.stringify({ page: { limit: 1000, offset: 0 }, filters: {} }),
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
