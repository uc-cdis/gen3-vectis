'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SIEM_DEFAULT_WORKSPACE_CONFIG } from './siemWorkspaceDefaults';

type UnifiedEvent = {
  timestamp: string;
  eventType: string;
  severity: string;
  source: string;
  target: string;
  account: string;
  action: string;
};

type SiemWorkspaceProps = {
  rows: UnifiedEvent[];
  workspaceConfig?: Record<string, unknown>;
  resetToken?: number;
};

type PSPWorkspaceElement = HTMLElement & {
  tables: Map<string, unknown>;
  restore: (config: unknown) => Promise<void>;
  flush: () => Promise<void>;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'perspective-workspace': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export default function SiemWorkspace({ rows, workspaceConfig, resetToken = 0 }: SiemWorkspaceProps) {
  const wsRef = useRef<PSPWorkspaceElement | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        setInitError(null);

        const [perspMod] = await Promise.all([
          import('@finos/perspective/dist/esm/perspective.inline.js'),
          import('@finos/perspective-viewer/dist/esm/perspective-viewer.inline.js'),
          import('@finos/perspective-viewer-datagrid'),
          import('@finos/perspective-viewer-d3fc'),
          import('@finos/perspective-workspace'),
        ]);

        if (!mounted || !wsRef.current) return;

        const workspace = wsRef.current;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const perspective = (perspMod as any).default ?? perspMod;

        // Build threat-intel watchlist from feed rows. These are IOCs (known-bad
        // sources/domains/hashes) — they describe what to look for, not events
        // that happened. We use them to enrich real observed traffic below.
        const threatSources = new Set<string>();
        const threatTargets = new Set<string>();
        for (const row of rows) {
          if (String(row.eventType || '').toLowerCase() === 'threat') {
            if (row.source) threatSources.add(String(row.source));
            if (row.target) threatTargets.add(String(row.target));
          }
        }

        // Enrich observed events. Threat-intel feed rows are dropped from the
        // events table — they're a watchlist, not incidents — and instead used
        // to mark `iocMatch` on real WAF/audit/VPC traffic.
        const incomingLogs = rows
          .filter((row) => String(row.eventType || '').toLowerCase() !== 'threat')
          .map((row) => {
            const severityLevel = String(row.severity || '').toLowerCase();
            const actionUpper = String(row.action || '').toUpperCase();
            const enforcement = actionUpper.includes('BLOCK')
              ? 'Blocked'
              : actionUpper.includes('ALLOW')
                ? 'Allowed'
                : 'Observed';
            const iocMatch =
              (!!row.source && threatSources.has(String(row.source))) ||
              (!!row.target && threatTargets.has(String(row.target)));

            // Priority model — what an analyst should look at first:
            //   1-Critical: a known-bad pattern got through (IOC not blocked, or
            //               high-severity WAF rule fired but was Allowed).
            //   2-High:     known-bad pattern caught (IOC blocked, or high-sev
            //               WAF blocked) — still worth review.
            //   3-Elevated: medium-severity activity.
            //   4-Baseline: everything else.
            const isHigh = severityLevel === 'high';
            const isMed = severityLevel === 'medium';
            const bypassed = enforcement !== 'Blocked';
            const riskBand =
              (iocMatch && bypassed) || (isHigh && bypassed)
                ? '1-Critical'
                : iocMatch || isHigh
                  ? '2-High'
                  : isMed
                    ? '3-Elevated'
                    : '4-Baseline';
            const severityWeight =
              riskBand === '1-Critical'
                ? 10
                : riskBand === '2-High'
                  ? 7
                  : riskBand === '3-Elevated'
                    ? 4
                    : 1;

            return {
              severityLevel,
              signalClass: String(row.eventType || 'Unknown'),
              enforcement,
              riskBand,
              severityWeight,
              iocMatch,
              ...row,
              name: (row as Record<string, unknown>).name ?? row.source ?? '-',
              src_ip: (row as Record<string, unknown>).src_ip ?? row.source ?? '-',
              event_source: (row as Record<string, unknown>).event_source ?? '-',
              rule_id: (row as Record<string, unknown>).rule_id ?? '-',
              pattern_type: (row as Record<string, unknown>).pattern_type ?? '-',
              sourceIndex: (row as Record<string, unknown>).sourceIndex ?? '-',
              timestampLocal: row.timestamp
                ? new Date(row.timestamp).toLocaleString()
                : '-',
              timeHour: row.timestamp
                ? new Date(row.timestamp).toISOString().slice(0, 13).replace('T', ' ') + ':00'
                : '?',
              isIncident: riskBand === '1-Critical' || riskBand === '2-High',
              // Minute-granularity bucket  "YYYY-MM-DD HH:mm"  → readable X-axis labels
              timeSlot: row.timestamp
                ? new Date(row.timestamp).toISOString().slice(0, 16).replace('T', ' ')
                : '?',
            };
          });

        const sanitizedData = incomingLogs.map((log) => ({
          ...log,
          count: 1, // Hardcoded integer row count for flawless Perspective aggregations
        }));

        const worker = await perspective.worker();
        const schema = {
          timestamp: 'string',
          eventType: 'string',
          severityLevel: 'string',
          signalClass: 'string',
          enforcement: 'string',
          riskBand: 'string',
          severityWeight: 'integer',
          iocMatch: 'boolean',
          severity: 'string',
          source: 'string',
          target: 'string',
          account: 'string',
          action: 'string',
          name: 'string',
          src_ip: 'string',
          event_source: 'string',
          rule_id: 'string',
          pattern_type: 'string',
          sourceIndex: 'string',
          timestampLocal: 'string',
          timeHour: 'string',
          isIncident: 'boolean',
          timeSlot: 'string',
          count: 'integer',
        } as const;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = await worker.table(schema as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await table.update(sanitizedData as any);
        workspace.tables.set('events', table);

        await workspace.restore(workspaceConfig ?? SIEM_DEFAULT_WORKSPACE_CONFIG);
        await workspace.flush();
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to initialize Perspective workspace';
        console.error('[SIEM] Perspective workspace init failed:', error);
        if (mounted) {
          setInitError(message);
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [rows, workspaceConfig, resetToken]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <perspective-workspace
        ref={wsRef as unknown as React.RefObject<HTMLElement>}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {initError ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: '20px',
            color: '#a4343a',
            background: 'rgba(253, 252, 251, 0.92)',
            fontSize: '14px',
          }}
        >
          Perspective workspace failed to initialize: {initError}
        </div>
      ) : null}
    </div>
  );
}
