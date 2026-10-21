/**
 * The console's data contract. Types are generated from the siem-app pydantic models
 * (`siem-app/scripts/export_frontend.py`), so the two sides cannot drift. Do not hand-write response types.
 */
export type {
  AccountNames,
  AiSummaryResponse,
  AlertBulkRequest,
  AlertBulkResponse,
  AlertGroup,
  AlertPatch,
  AlertsRequest,
  AlertsResponse,
  Bucket,
  CaseCreate,
  CaseList,
  CaseNote,
  CasePatch,
  CaseRecord,
  CaseRef,
  CatalogResponse,
  ColumnMeta,
  CoverageResponse,
  CoverageRow,
  DecisionRequest,
  DecisionResponse,
  EntityProfileRequest,
  EntityProfileResponse,
  EntitySeed,
  EvidenceAction,
  AggregateRequest,
  AggregateResponse,
  AggregateRow,
  FacetResult,
  FacetsRequest,
  FacetsResponse,
  FeatureDiff,
  FilterClause,
  FindSimilarRequest,
  FindSimilarResponse,
  GeoInfo,
  GraphEdge,
  GraphNode,
  GraphTraverseRequest,
  GraphTraverseResponse,
  HealthQueue,
  HealthResponse,
  HealthSource,
  Hunt,
  HuntCreate,
  HuntList,
  HuntPatch,
  IndexCatalog,
  IndicatorMatch,
  IndicatorResolveRequest,
  IndicatorResolveResponse,
  Neighbor,
  OriginBucket,
  OverviewRequest,
  OverviewResponse,
  Paging,
  QuarantineGroup,
  QuarantineRecord,
  QuarantineRequest,
  QuarantineResponse,
  QuerySpec,
  RowsRequest,
  RowsResponse,
  SavedView,
  SavedViewList,
  SequenceStage,
  SharedNeighbor,
  SimilarHit,
  SimilarRequest,
  SimilarResponse,
  SortSpec,
  StructuralMatch,
  TimeWindow,
  TimelinePoint,
  TimelineRequest,
  TimelineResponse,
  TriageRequest,
  TriageResponse,
  TriageRow,
  TriageStrip,
  WatchlistEntry,
  WatchlistRequest,
  WatchlistResponse,
  WhyBaseline,
  WhyEvidence,
  WhyGraph,
  WhyIndicator,
  WhyNovelty,
  WhyResponse,
  WhyRule,
  WhySequence,
} from './generated/contract.generated';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type DetectorTier = 'ioc' | 'rule' | 'baseline' | 'novelty';
export type TriageStatus = 'new' | 'triaged' | 'investigating' | 'resolved' | 'noise';
/** An index is a dictionary entity, so the names are whatever the tenant's dictionary declares ('all_events' is every event index at once). */
export type IndexName = string;
export type IndexCategory = 'events' | 'findings' | 'entities' | 'threat_intel';
export type EntityType = 'ip' | 'domain' | 'url' | 'hash' | 'email' | 'path' | 'host' | 'user' | 'session' | 'arn';
export type WhySection = WhyRuleSection | WhyBaselineSection | WhySequenceSection | WhyNoveltySection | WhyIndicatorSection | WhyGraphSection;

import type {
  WhyBaseline as WhyBaselineSection,
  WhyGraph as WhyGraphSection,
  WhyIndicator as WhyIndicatorSection,
  WhyNovelty as WhyNoveltySection,
  WhyRule as WhyRuleSection,
  WhySequence as WhySequenceSection,
} from './generated/contract.generated';

/** Display order for severity. Sort by rank, never by the string ("low" sorts before "medium"). */
export const SEVERITIES: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'Info',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** Mantine colour per severity. Uses named Mantine colours so it works with the Gen3 theme without extra tokens. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  info: 'gray',
  low: 'blue',
  medium: 'yellow',
  high: 'orange',
  critical: 'red',
};

export const TIER_LABEL: Record<DetectorTier, string> = {
  ioc: 'Indicator',
  rule: 'Rule',
  baseline: 'Baseline',
  novelty: 'Novelty',
};

export const STATUS_LABEL: Record<TriageStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  investigating: 'Investigating',
  resolved: 'Resolved',
  noise: 'Noise',
};
