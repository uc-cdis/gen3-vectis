import { useEffect, useMemo, useState } from 'react';

import type { JSONObject } from '@gen3/core';
import type {
  DiscoverDataHookResponse,
  DiscoveryTableDataHook,
} from '@gen3/frontend/dist/dts/features/Discovery/types';

type AuditEventRow = {
  submitter_id?: string;
  timestamp?: string;
  action_name?: string;
  event_source?: string;
  result?: string;
  cloud_account_id?: string;
  cloud_region?: string;
};

type GuppyGraphQLResponse = {
  data?: {
    audit_event?: AuditEventRow[];
    auditEvent?: AuditEventRow[];
    _aggregation?: {
      audit_event?: { _totalCount?: number };
      auditEvent?: { _totalCount?: number };
    };
  };
  errors?: Array<{ message: string }>;
};
//
// `_aggregation { audit_event { _totalCount } }` gives us the true row
// count for the current filter so the table can show accurate pagination
// without over-fetching.
const AUDIT_EVENT_QUERY = `query AuditEventTable($filter: JSON, $offset: Int, $first: Int) {
  audit_event(filter: $filter, offset: $offset, first: $first) {
    submitter_id
    timestamp
    action_name
    event_source
    result
    cloud_account_id
    cloud_region
  }
  _aggregation {
    audit_event(filter: $filter) {
      _totalCount
    }
  }
}`;

// Columns the SEARCH operator may target — these are also the columns
// surfaced in mapAuditEvent below. Keep this list in sync with the
// search Lambda's `selectable_columns` for audit_event.
const SEARCH_COLUMNS = [
  'submitter_id',
  'action_name',
  'event_source',
  'result',
  'cloud_account_id',
  'cloud_region',
] as const;

const DEFAULT_VARIABLES = { filter: {}, offset: 0, first: 50 };

// Snapshot-first read. When NEXT_PUBLIC_GUPPY_SNAPSHOT_BASE_URL is set the
// loader tries a pre-materialised snapshot at
// `${base}/snapshots/${tenant}/audit_event/${queryHash}.json`. Only the
// default empty-filter / first-page query will match a published snapshot;
// everything else falls through to live `/guppy/graphql`.
//
// Treat a value of "/" (or any non-null value that strips to empty) as
// "enabled, same origin" so operators can set the var to `/` for the
// common case of serving snapshots through revproxy on the same host.
const SNAPSHOT_BASE_RAW = process.env.NEXT_PUBLIC_GUPPY_SNAPSHOT_BASE_URL;
const SNAPSHOT_ENABLED =
  SNAPSHOT_BASE_RAW != null && SNAPSHOT_BASE_RAW !== '';
const SNAPSHOT_BASE_URL = (SNAPSHOT_BASE_RAW ?? '').replace(/\/$/, '');
const SNAPSHOT_TENANT =
  process.env.NEXT_PUBLIC_GUPPY_SNAPSHOT_TENANT ?? 'vectis';

// Opt-in: when set to "true", attach X-Auth-Unmask: true on the live
// fetch. The search-auth-proxy still gates this on the user's Arborist
// resources, so the worst case is the header is ignored.
const REQUEST_UNMASK =
  (process.env.NEXT_PUBLIC_DISCOVERY_REQUEST_UNMASK ?? '').toLowerCase() ===
  'true';

const getCookieValue = (name: string): string | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split('=');
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }
  return null;
};

const sortedStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(sortedStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedStringify(v)}`).join(',')}}`;
};

const sha256Hex = async (input: string): Promise<string> => {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const computeQueryHash = async (
  query: string,
  variables: unknown,
): Promise<string> => {
  const canonical = sortedStringify({ query: query.trim(), variables });
  const hex = await sha256Hex(canonical);
  return hex.slice(0, 32);
};

const tryFetchSnapshot = async (
  index: string,
  query: string,
  variables: unknown,
  signal?: AbortSignal,
): Promise<GuppyGraphQLResponse | null> => {
  if (!SNAPSHOT_ENABLED) {
    return null;
  }
  try {
    const hash = await computeQueryHash(query, variables);
    const url = `${SNAPSHOT_BASE_URL}/snapshots/${SNAPSHOT_TENANT}/${index}/${hash}.json`;
    const resp = await fetch(url, { method: 'GET', signal });
    if (!resp.ok) {
      return null;
    }
    return (await resp.json()) as GuppyGraphQLResponse;
  } catch {
    return null;
  }
};

const EMPTY_STATUS = {
  isFetching: false,
  isLoading: false,
  isUninitialized: true,
  isSuccess: false,
  isError: false,
};

const mapAuditEvent = (row: AuditEventRow): JSONObject => ({
  _hdp_uid: row.submitter_id ?? '',
  _unique_id: row.submitter_id ?? 'n/a',
  full_name: row.action_name ?? 'n/a',
  study_title: row.event_source ?? 'n/a',
  source: row.cloud_account_id ?? 'n/a',
  event_name: row.result ?? row.action_name ?? 'n/a',
  event_time: row.timestamp ?? 'n/a',
  study_description: [
    row.action_name,
    row.result,
    row.cloud_region,
    row.timestamp,
  ]
    .filter(Boolean)
    .join(' | ') || 'No event summary available.',
  authz: [],
  tags: [],
  data_availability: 'available',
});

// Build a Guppy filter AST from the discovery keyword search box.
// Each non-empty keyword becomes an OR-of-SEARCH across the searchable
// columns; all keywords are AND-ed together so multi-token searches
// narrow the result set (matches the old client-side `keywords.every`
// behaviour).
const buildFilter = (rawKeywords: readonly string[] | undefined) => {
  const keywords = (rawKeywords ?? [])
    .map((kw) => kw.trim())
    .filter((kw) => kw.length > 0);
  if (keywords.length === 0) {
    return {};
  }
  const clauses = keywords.map((keyword) => ({
    OR: SEARCH_COLUMNS.map((col) => ({ SEARCH: { [col]: keyword } })),
  }));
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
};

export const useAuditEventSearchData: DiscoveryTableDataHook = ({
  pagination,
  searchTerms,
}): DiscoverDataHookResponse => {
  const [rows, setRows] = useState<JSONObject[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [dataRequestStatus, setDataRequestStatus] = useState(EMPTY_STATUS);

  // Stable serialisation of the keyword array so the effect only re-runs
  // when the filter content actually changes (not just identity).
  const keywordKey = useMemo(
    () => JSON.stringify(searchTerms.keyword.keywords ?? []),
    [searchTerms.keyword.keywords],
  );

  useEffect(() => {
    let cancelled = false;

    const variables = {
      filter: buildFilter(searchTerms.keyword.keywords),
      offset: pagination.offset,
      first: pagination.pageSize,
    };

    const load = async () => {
      setDataRequestStatus({
        isFetching: true,
        isLoading: true,
        isUninitialized: false,
        isSuccess: false,
        isError: false,
      });

      try {
        // Try the precomputed snapshot first; only the default
        // empty-filter / first-page variables will match a published
        // snapshot. Everything else falls through to live.
        const isDefaultQuery =
          sortedStringify(variables) === sortedStringify(DEFAULT_VARIABLES);
        let payload = isDefaultQuery
          ? await tryFetchSnapshot('audit_event', AUDIT_EVENT_QUERY, variables)
          : null;

        if (!payload) {
          const csrfToken = getCookieValue('csrftoken');
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            // Revproxy validates cookie auth POSTs by requiring
            // X-CSRF-Token == csrftoken cookie.
            'X-CSRF-Token': csrfToken ?? 'true',
          };
          if (REQUEST_UNMASK) {
            headers['X-Auth-Unmask'] = 'true';
          }
          const response = await fetch('/guppy/graphql', {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify({
              query: AUDIT_EVENT_QUERY,
              variables,
            }),
          });

          if (!response.ok) {
            throw new Error(`Guppy request failed with status ${response.status}`);
          }

          payload = (await response.json()) as GuppyGraphQLResponse;
        }

        if (payload.errors && payload.errors.length > 0) {
          throw new Error(payload.errors.map((e) => e.message).join('; '));
        }
        const data =
          payload.data?.audit_event ?? payload.data?.auditEvent ?? [];
        const totalCount =
          payload.data?._aggregation?.audit_event?._totalCount ??
          payload.data?._aggregation?.auditEvent?._totalCount ??
          data.length;

        if (!cancelled) {
          setRows(data.map(mapAuditEvent));
          setTotalHits(totalCount);
          setDataRequestStatus({
            isFetching: false,
            isLoading: false,
            isUninitialized: false,
            isSuccess: true,
            isError: false,
          });
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setTotalHits(0);
          setDataRequestStatus({
            isFetching: false,
            isLoading: false,
            isUninitialized: false,
            isSuccess: false,
            isError: true,
          });
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [pagination.offset, pagination.pageSize, keywordKey, searchTerms.keyword.keywords]);

  return {
    data: rows,
    hits: totalHits,
    advancedSearchFilterValues: [],
    dataRequestStatus,
    summaryStatistics: [
      {
        name: 'Events',
        field: '_unique_id',
        type: 'count',
        value: totalHits,
      },
    ],
    charts: {},
    suggestions: [],
    clearSearch: undefined,
  };
};
