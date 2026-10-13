/* GENERATED from the siem-app contract (scripts/export_frontend.py). Do not edit by hand. */

export interface SiemContract {
  AiSummaryResponse?: AiSummaryResponse;
  AlertBulkRequest?: AlertBulkRequest;
  AlertBulkResponse?: AlertBulkResponse;
  AlertGroup?: AlertGroup;
  AlertPatch?: AlertPatch;
  AlertsRequest?: AlertsRequest;
  AlertsResponse?: AlertsResponse;
  Bucket?: Bucket;
  CaseCreate?: CaseCreate;
  CaseList?: CaseList;
  CaseNote?: CaseNote;
  CasePatch?: CasePatch;
  CaseRecord?: CaseRecord;
  CaseRef?: CaseRef;
  CatalogResponse?: CatalogResponse;
  ColumnMeta?: ColumnMeta;
  CoverageResponse?: CoverageResponse;
  CoverageRow?: CoverageRow;
  DecisionRequest?: DecisionRequest;
  DecisionResponse?: DecisionResponse;
  EntityProfileRequest?: EntityProfileRequest;
  EntityProfileResponse?: EntityProfileResponse;
  EntityRecallRequest?: EntityRecallRequest;
  EntityRecallResponse?: EntityRecallResponse;
  EntitySeed?: EntitySeed;
  EvidenceAction?: EvidenceAction;
  FacetResult?: FacetResult;
  FacetsRequest?: FacetsRequest;
  FacetsResponse?: FacetsResponse;
  FeatureDiff?: FeatureDiff;
  FilterClause?: FilterClause;
  FindSimilarRequest?: FindSimilarRequest;
  FindSimilarResponse?: FindSimilarResponse;
  GeoInfo?: GeoInfo;
  GraphEdge?: GraphEdge;
  GraphNode?: GraphNode;
  GraphTraverseRequest?: GraphTraverseRequest;
  GraphTraverseResponse?: GraphTraverseResponse;
  HealthQueue?: HealthQueue;
  HealthResponse?: HealthResponse;
  HealthSource?: HealthSource;
  Hunt?: Hunt;
  HuntCreate?: HuntCreate;
  HuntList?: HuntList;
  HuntPatch?: HuntPatch;
  IndexCatalog?: IndexCatalog;
  IndicatorMatch?: IndicatorMatch;
  IndicatorResolveRequest?: IndicatorResolveRequest;
  IndicatorResolveResponse?: IndicatorResolveResponse;
  MembersRequest?: MembersRequest;
  MembersResponse?: MembersResponse;
  Neighbor?: Neighbor;
  OverviewRequest?: OverviewRequest;
  OverviewResponse?: OverviewResponse;
  OverviewTotals?: OverviewTotals;
  Paging?: Paging;
  QuarantineGroup?: QuarantineGroup;
  QuarantineRecord?: QuarantineRecord;
  QuarantineRequest?: QuarantineRequest;
  QuarantineResponse?: QuarantineResponse;
  QuerySpec?: QuerySpec;
  RowsRequest?: RowsRequest;
  RowsResponse?: RowsResponse;
  SavedView?: SavedView;
  SavedViewInput?: SavedViewInput;
  SavedViewList?: SavedViewList;
  SequenceStage?: SequenceStage;
  SharedNeighbor?: SharedNeighbor;
  SimilarHit?: SimilarHit;
  SimilarRequest?: SimilarRequest;
  SimilarResponse?: SimilarResponse;
  SortSpec?: SortSpec;
  StructuralMatch?: StructuralMatch;
  TimeWindow?: TimeWindow;
  TimelinePoint?: TimelinePoint;
  TimelineRequest?: TimelineRequest;
  TimelineResponse?: TimelineResponse;
  TriageRequest?: TriageRequest;
  TriageResponse?: TriageResponse;
  TriageRow?: TriageRow;
  TriageStrip?: TriageStrip;
  WatchlistEntry?: WatchlistEntry;
  WatchlistRequest?: WatchlistRequest;
  WatchlistResponse?: WatchlistResponse;
  WhyBaseline?: WhyBaseline;
  WhyEvidence?: WhyEvidence;
  WhyGraph?: WhyGraph;
  WhyIndicator?: WhyIndicator;
  WhyNovelty?: WhyNovelty;
  WhyResponse?: WhyResponse;
  WhyRule?: WhyRule;
  WhySequence?: WhySequence;
}
/**
 * The AI analyst slot. The producer is behind the AI gateway and arrives later; the UI renders every state.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "AiSummaryResponse".
 */
export interface AiSummaryResponse {
  detail?: string | null;
  note?: CaseNote | null;
  state: "not_configured" | "running" | "ready" | "failed";
}
/**
 * An analyst or agent note. Agent notes carry provenance and never change case or alert state.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CaseNote".
 */
export interface CaseNote {
  at: string;
  author: string;
  author_kind: "analyst" | "agent";
  body: string;
  input_digest?: string | null;
  /**
   * Model id; set only for agent notes
   */
  model?: string | null;
  note_id: string;
  prompt_hash?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "AlertBulkRequest".
 */
export interface AlertBulkRequest {
  /**
   * @minItems 1
   * @maxItems 100
   */
  group_ids: string[];
  patch: AlertPatch;
}
/**
 * Analyst state. Written to the S3 overlay, never to the Delta table.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "AlertPatch".
 */
export interface AlertPatch {
  assignee?: string | null;
  case_id?: string | null;
  disposition?: ("true_positive" | "false_positive" | "true_negative" | "false_negative" | "benign" | "unknown") | null;
  /**
   * Conditional write; a mismatch returns 412
   */
  expected_etag?: string | null;
  noise?: boolean | null;
  /**
   * Why. Required when closing as noise or resolved; recorded with the change
   */
  reason?: string | null;
  status?: ("new" | "triaged" | "investigating" | "resolved" | "noise") | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "AlertBulkResponse".
 */
export interface AlertBulkResponse {
  failed: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$".
     */
    [k: string]: string;
  };
  updated: string[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "AlertGroup".
 */
export interface AlertGroup {
  allowed_count: number;
  assignee?: string | null;
  base_severity?: ("info" | "low" | "medium" | "high" | "critical") | null;
  blocked_count: number;
  bytes_out_max?: number | null;
  bytes_out_p99?: number | null;
  case_id?: string | null;
  control_worked: boolean;
  /**
   * @maxItems 8
   */
  corroboration?: string[];
  detector_tier: "ioc" | "rule" | "baseline" | "novelty";
  disposition?: ("true_positive" | "false_positive" | "true_negative" | "false_negative" | "benign" | "unknown") | null;
  distinct_accounts: number;
  distinct_countries: number;
  distinct_src_ips: number;
  /**
   * Version of this alert's analyst state. Send it back as expected_etag
   */
  etag?: string | null;
  evidence_uri?: string | null;
  first_seen: string;
  group_date: string;
  group_id: string;
  last_seen: string;
  /**
   * @maxItems 50
   */
  matched_indicators?: string[];
  noise?: boolean;
  novelty_class?: ("normal" | "drift" | "anomaly") | null;
  novelty_score?: number | null;
  occurrence_count: number;
  robust_zscore?: number | null;
  rule_id?: string | null;
  severity: "info" | "low" | "medium" | "high" | "critical";
  severity_score: number;
  signature_id: string;
  signature_label?: string | null;
  status?: "new" | "triaged" | "investigating" | "resolved" | "noise";
  /**
   * @maxItems 50
   */
  techniques?: string[];
  tenant_id: string;
  tenants_affected: number;
  title: string;
  /**
   * The most active source entities. None means not computed: show 'unmeasured'
   */
  top_sources?: EntitySeed[] | null;
  /**
   * @maxItems 10
   */
  why?: string[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "EntitySeed".
 */
export interface EntitySeed {
  type: "ip" | "domain" | "url" | "hash" | "email" | "host" | "user" | "session" | "arn";
  value: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "AlertsRequest".
 */
export interface AlertsRequest {
  /**
   * @maxItems 4
   */
  detector_tiers?: ("ioc" | "rule" | "baseline" | "novelty")[];
  /**
   * @maxItems 20
   */
  filters?: FilterClause[];
  include_noise?: boolean;
  min_severity?: ("info" | "low" | "medium" | "high" | "critical") | null;
  paging?: Paging;
  sort?: "severity" | "last_seen" | "occurrence_count" | "novelty_score";
  /**
   * @maxItems 5
   */
  statuses?: ("new" | "triaged" | "investigating" | "resolved" | "noise")[];
  window: TimeWindow;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "FilterClause".
 */
export interface FilterClause {
  field: string;
  op: "eq" | "neq" | "in" | "gte" | "lte" | "contains";
  value: string | number | boolean | (string | number)[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "Paging".
 */
export interface Paging {
  limit?: number;
  offset?: number;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TimeWindow".
 */
export interface TimeWindow {
  end: string;
  start: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "AlertsResponse".
 */
export interface AlertsResponse {
  as_of: string;
  groups: AlertGroup[];
  /**
   * Delta version the groups were read at
   */
  source_version: number;
  total: number;
  truncated: boolean;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "Bucket".
 */
export interface Bucket {
  count: number;
  key: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CaseCreate".
 */
export interface CaseCreate {
  assignee?: string | null;
  description?: string;
  /**
   * @maxItems 100
   */
  group_ids?: string[];
  priority?: "low" | "medium" | "high" | "critical";
  /**
   * @maxItems 20
   */
  tags?: string[];
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CaseList".
 */
export interface CaseList {
  cases: CaseRecord[];
  total: number;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CaseRecord".
 */
export interface CaseRecord {
  assignee?: string | null;
  case_id: string;
  created_at: string;
  description: string;
  etag: string;
  /**
   * @maxItems 100
   */
  group_ids: string[];
  /**
   * @maxItems 500
   */
  notes: CaseNote[];
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "resolved" | "closed";
  /**
   * @maxItems 20
   */
  tags: string[];
  title: string;
  updated_at: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CasePatch".
 */
export interface CasePatch {
  add_note?: string | null;
  assignee?: string | null;
  description?: string | null;
  /**
   * Required: every case edit is conditional
   */
  expected_etag: string;
  priority?: ("low" | "medium" | "high" | "critical") | null;
  status?: ("open" | "in_progress" | "resolved" | "closed") | null;
  tags?: string[] | null;
  title?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CaseRef".
 */
export interface CaseRef {
  case_id: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  title: string;
}
/**
 * Generated from the dictionary, so a new source gets filters and columns without UI code.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CatalogResponse".
 */
export interface CatalogResponse {
  as_of: string;
  /**
   * @maxItems 20
   */
  indexes: IndexCatalog[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "IndexCatalog".
 */
export interface IndexCatalog {
  /**
   * @maxItems 300
   */
  columns: ColumnMeta[];
  index_name: "http_activity" | "api_activity" | "authentication" | "audit_event" | "network_activity";
  label: string;
  time_field: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "ColumnMeta".
 */
export interface ColumnMeta {
  default_visible?: boolean;
  description?: string;
  enum_values?: string[] | null;
  filterable?: boolean;
  label: string;
  name: string;
  pii?: boolean;
  sortable?: boolean;
  type: "string" | "integer" | "float" | "boolean" | "timestamp" | "ip" | "enum";
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CoverageResponse".
 */
export interface CoverageResponse {
  caught: number;
  missed: number;
  rows: CoverageRow[];
  run_at: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "CoverageRow".
 */
export interface CoverageRow {
  replay: string;
  step: number;
  technique_id: string;
  verdict: "both" | "rule" | "behavioral" | "missed";
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "DecisionRequest".
 */
export interface DecisionRequest {
  comment?: string;
  disposition: "true_positive" | "false_positive" | "true_negative" | "false_negative" | "benign" | "unknown";
  group_id: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "DecisionResponse".
 */
export interface DecisionResponse {
  disposition: "true_positive" | "false_positive" | "true_negative" | "false_negative" | "benign" | "unknown";
  group_id: string;
  recorded_at: string;
  recorded_by: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "EntityProfileRequest".
 */
export interface EntityProfileRequest {
  type: "ip" | "domain" | "url" | "hash" | "email" | "host" | "user" | "session" | "arn";
  value: string;
  window?: TimeWindow | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "EntityProfileResponse".
 */
export interface EntityProfileResponse {
  as_of: string;
  /**
   * @maxItems 50
   */
  cases?: CaseRef[];
  /**
   * Matches beyond the caps, reported not hidden
   */
  dropped?: number;
  event_count?: number | null;
  first_seen?: string | null;
  geo?: GeoInfo | null;
  /**
   * This entity's node id in the graph; None when it has no node
   */
  graph_id?: string | null;
  /**
   * @maxItems 100
   */
  groups?: AlertGroup[];
  /**
   * @maxItems 50
   */
  indicator_matches?: IndicatorMatch[];
  key: string;
  last_seen?: string | null;
  /**
   * @maxItems 20
   */
  sources?: Bucket[];
  type: "ip" | "domain" | "url" | "hash" | "email" | "host" | "user" | "session" | "arn";
  value: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "GeoInfo".
 */
export interface GeoInfo {
  asn?: number | null;
  asn_org?: string | null;
  city?: string | null;
  country?: string | null;
}
/**
 * An intel indicator that matched. ``value`` is the matched IP, domain, URL, hash or address read from the indicator's
 * pattern; every other field is None when the intel node does not record it (never inferred).
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "IndicatorMatch".
 */
export interface IndicatorMatch {
  confidence?: number | null;
  description?: string | null;
  first_seen?: string | null;
  /**
   * The intel node id: an identifier, not the matched value
   */
  indicator_id?: string | null;
  /**
   * @maxItems 10
   */
  indicator_types?: string[];
  last_seen?: string | null;
  name?: string | null;
  revoked?: boolean;
  /**
   * The feed the indicator was loaded from
   */
  source?: string | null;
  /**
   * None when the indicator could not be read, so its type is not known
   */
  type?: ("ip" | "domain" | "url" | "hash" | "email") | null;
  valid_from?: string | null;
  valid_until?: string | null;
  value: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "EntityRecallRequest".
 */
export interface EntityRecallRequest {
  type: ("ip" | "domain" | "url" | "hash" | "email") | ("host" | "user" | "session" | "arn");
  value: string;
  window?: TimeWindow | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "EntityRecallResponse".
 */
export interface EntityRecallResponse {
  /**
   * Matches beyond the per-key and overall caps, reported not hidden
   */
  dropped: number;
  first_seen?: string | null;
  /**
   * @maxItems 100
   */
  groups: AlertGroup[];
  key: string;
  last_seen?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "EvidenceAction".
 */
export interface EvidenceAction {
  /**
   * ALLOW, BLOCK, COUNT ... as the source recorded it
   */
  action: string;
  count: number;
  rule_id?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "FacetResult".
 */
export interface FacetResult {
  /**
   * True when counts come from a rollup or sketch, not a scan
   */
  approximate: boolean;
  /**
   * @maxItems 50
   */
  buckets?: Bucket[];
  field: string;
  kind: "enum" | "range" | "time";
  max?: string | number | null;
  min?: string | number | null;
  null_count?: number | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "FacetsRequest".
 */
export interface FacetsRequest {
  /**
   * @minItems 1
   * @maxItems 12
   */
  fields: string[];
  /**
   * @maxItems 20
   */
  filters?: FilterClause[];
  index_name: "http_activity" | "api_activity" | "authentication" | "audit_event" | "network_activity";
  top_n?: number;
  window: TimeWindow;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "FacetsResponse".
 */
export interface FacetsResponse {
  as_of: string;
  /**
   * @maxItems 12
   */
  facets: FacetResult[];
  index_name: "http_activity" | "api_activity" | "authentication" | "audit_event" | "network_activity";
  /**
   * e.g. 'counted over the first 100,000 rows read'
   *
   * @maxItems 10
   */
  notes?: string[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "FeatureDiff".
 */
export interface FeatureDiff {
  feature: string;
  nearest?: string | null;
  this?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "FindSimilarRequest".
 */
export interface FindSimilarRequest {
  group_id?: string | null;
  /**
   * @minItems 1
   * @maxItems 4
   */
  kinds?: ("exact" | "structural" | "behavioral" | "graph")[];
  limit?: number;
  seed?: EntitySeed | null;
  window?: TimeWindow | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "FindSimilarResponse".
 */
export interface FindSimilarResponse {
  /**
   * @maxItems 100
   */
  behavioral?: SimilarHit[];
  /**
   * @maxItems 100
   */
  exact?: AlertGroup[];
  graph?: GraphTraverseResponse | null;
  measured: {
    [k: string]: boolean;
  };
  /**
   * @maxItems 50
   */
  structural?: StructuralMatch[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SimilarHit".
 */
export interface SimilarHit {
  distance: number;
  group_id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "GraphTraverseResponse".
 */
export interface GraphTraverseResponse {
  edges: GraphEdge[];
  /**
   * @maxItems 500
   */
  nodes: GraphNode[];
  truncated: boolean;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "GraphEdge".
 */
export interface GraphEdge {
  dst_id: string;
  edge_type: string;
  src_id: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "GraphNode".
 */
export interface GraphNode {
  id: string;
  label: string;
  properties?: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "StructuralMatch".
 */
export interface StructuralMatch {
  /**
   * @maxItems 50
   */
  entities: Bucket[];
  feature: "ja4" | "user_agent" | "asn" | "path_signature";
  value: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "GraphTraverseRequest".
 */
export interface GraphTraverseRequest {
  limit?: number;
  max_hops?: number;
  start_id: string;
  /**
   * Edges considered; the server default (7 days) applies when omitted
   */
  window?: TimeWindow | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "HealthQueue".
 */
export interface HealthQueue {
  consumers?: number | null;
  depth?: number | null;
  dequeued_per_min?: number | null;
  enqueued_per_min?: number | null;
  name: string;
  role: "ingest" | "cleanup" | "failures" | "other";
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "HealthResponse".
 */
export interface HealthResponse {
  as_of: string;
  /**
   * @maxItems 20
   */
  notes?: string[];
  quarantine_count?: number | null;
  /**
   * Records older than the window; None when unknown
   */
  quarantine_older_count?: number | null;
  /**
   * @maxItems 50
   */
  quarantine_reasons?: Bucket[];
  /**
   * quarantine_count and reasons cover this many recent hours
   */
  quarantine_window_hours?: number | null;
  /**
   * @maxItems 50
   */
  queues: HealthQueue[];
  /**
   * @maxItems 100
   */
  sources: HealthSource[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "HealthSource".
 */
export interface HealthSource {
  events_1h?: number | null;
  events_24h?: number | null;
  last_event_at?: string | null;
  source: string;
  /**
   * None when freshness is not evaluated: see stale_reason
   */
  stale?: boolean | null;
  /**
   * Why stale is None: no SIEM_SOURCE_EXPECTATIONS entry, or an expectation the rollups cannot evaluate
   */
  stale_reason?: ("no_expectation" | "not_measurable") | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "Hunt".
 */
export interface Hunt {
  created_at: string;
  created_by: string;
  etag: string;
  hunt_id: string;
  hypothesis: string;
  spec: QuerySpec;
  title: string;
  updated_at: string;
  verdict: "open" | "proven" | "disproven" | "inconclusive";
}
/**
 * One view of the data. It renders as Python, curl, GraphQL, a DRS manifest or a notebook, so it is the
 * single description of 'what the analyst is looking at'. Validated against the dictionary server-side.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "QuerySpec".
 */
export interface QuerySpec {
  /**
   * @maxItems 60
   */
  columns?: string[];
  /**
   * @maxItems 20
   */
  filters?: FilterClause[];
  grain?: ("1m" | "5m" | "1h") | null;
  hops?: number;
  index_name: "http_activity" | "api_activity" | "authentication" | "audit_event" | "network_activity";
  seed?: EntitySeed | null;
  sort?: SortSpec | null;
  window: TimeWindow;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SortSpec".
 */
export interface SortSpec {
  dir?: "asc" | "desc";
  field: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "HuntCreate".
 */
export interface HuntCreate {
  hypothesis?: string;
  spec: QuerySpec;
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "HuntList".
 */
export interface HuntList {
  hunts: Hunt[];
  total: number;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "HuntPatch".
 */
export interface HuntPatch {
  expected_etag: string;
  hypothesis?: string | null;
  spec?: QuerySpec | null;
  title?: string | null;
  verdict?: ("open" | "proven" | "disproven" | "inconclusive") | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "IndicatorResolveRequest".
 */
export interface IndicatorResolveRequest {
  /**
   * matched_indicators entries of alert groups: intel node ids or plain values
   *
   * @minItems 1
   * @maxItems 50
   */
  ids: string[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "IndicatorResolveResponse".
 */
export interface IndicatorResolveResponse {
  /**
   * One per requested id, in order
   *
   * @maxItems 50
   */
  matches: IndicatorMatch[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "MembersRequest".
 */
export interface MembersRequest {
  paging?: Paging;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "MembersResponse".
 */
export interface MembersResponse {
  group_id: string;
  /**
   * @maxItems 1000
   */
  members: {
    [k: string]: unknown;
  }[];
  total: number;
  truncated: boolean;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "Neighbor".
 */
export interface Neighbor {
  /**
   * @maxItems 20
   */
  differing?: FeatureDiff[];
  distance: number;
  group_id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "OverviewRequest".
 */
export interface OverviewRequest {
  /**
   * @maxItems 20
   */
  filters?: FilterClause[];
  top_n?: number;
  window: TimeWindow;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "OverviewResponse".
 */
export interface OverviewResponse {
  as_of: string;
  canUnmask: boolean;
  currentUser?: string | null;
  /**
   * How the numbers were computed (rollup, bounded raw scan, sample)
   *
   * @maxItems 10
   */
  notes?: string[];
  /**
   * @maxItems 50
   */
  topCountries: Bucket[];
  /**
   * @maxItems 50
   */
  topEventSources: Bucket[];
  /**
   * @maxItems 50
   */
  topRules: Bucket[];
  /**
   * @maxItems 50
   */
  topSourceIps: Bucket[];
  totals: OverviewTotals;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "OverviewTotals".
 */
export interface OverviewTotals {
  /**
   * None when the audit source has no data at all (unmeasured, not zero)
   */
  audit?: number | null;
  /**
   * Alert groups of tier ioc that overlap the window: alerts that matched an indicator
   */
  ioc_alerts?: number | null;
  /**
   * None until a telemetry index exists
   */
  telemetry?: number | null;
  /**
   * Indicators LOADED (current intel objects, not windowed). NOT the number of matches
   */
  threat: number;
  waf: number;
}
/**
 * Records that share a reason. Counts cover the records read, so they are a lower bound when the response is truncated.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "QuarantineGroup".
 */
export interface QuarantineGroup {
  count: number;
  first_seen?: string | null;
  /**
   * Plain-language reading of the reason, from fixed rules
   */
  hint: string;
  last_seen?: string | null;
  reason: string;
  /**
   * Raw key of the newest record in the group
   */
  sample_key?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "QuarantineRecord".
 */
export interface QuarantineRecord {
  key: string;
  quarantined_at?: string | null;
  raw_key?: string | null;
  reason: string;
  source?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "QuarantineRequest".
 */
export interface QuarantineRequest {
  /**
   * True returns only records OLDER than the window instead of those inside it
   */
  older?: boolean;
  paging?: Paging;
  /**
   * Only records with exactly this reason (a QuarantineGroup.reason)
   */
  reason?: string | null;
  /**
   * How far back 'recent' reaches, by the record's quarantine time. Server default: 36
   */
  window_hours?: number | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "QuarantineResponse".
 */
export interface QuarantineResponse {
  /**
   * @maxItems 50
   */
  groups?: QuarantineGroup[];
  older?: boolean;
  /**
   * Records older than the window; None when not counted (unknown, not zero)
   */
  older_count?: number | null;
  records: QuarantineRecord[];
  /**
   * A lower bound when truncated
   */
  total: number;
  truncated?: boolean;
  window_hours?: number;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "RowsRequest".
 */
export interface RowsRequest {
  /**
   * @maxItems 60
   */
  columns?: string[];
  /**
   * @maxItems 20
   */
  filters?: FilterClause[];
  index_name: "http_activity" | "api_activity" | "authentication" | "audit_event" | "network_activity";
  paging?: Paging;
  sort?: SortSpec | null;
  window: TimeWindow;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "RowsResponse".
 */
export interface RowsResponse {
  as_of: string;
  columns: string[];
  index_name: "http_activity" | "api_activity" | "authentication" | "audit_event" | "network_activity";
  /**
   * @maxItems 5000
   */
  rows: {
    [k: string]: unknown;
  }[];
  /**
   * Delta version read; None when it could not be determined cheaply
   */
  source_version?: number | null;
  /**
   * None when counting would scan; the grid says 'at least'
   */
  total?: number | null;
  truncated: boolean;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SavedView".
 */
export interface SavedView {
  description?: string;
  id: string;
  is_default?: boolean;
  kind: "triage" | "hunt" | "dashboard" | "data";
  /**
   * Perspective viewer config for the grid/chart
   */
  layout?: {
    [k: string]: unknown;
  };
  owner?: string | null;
  scope: "shared" | "private";
  spec: QuerySpec;
  title: string;
}
/**
 * What a client sends to save a view. The server assigns id and owner and decides is_default.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SavedViewInput".
 */
export interface SavedViewInput {
  description?: string;
  kind: "triage" | "hunt" | "dashboard" | "data";
  /**
   * Perspective viewer config; capped at 64 KiB
   */
  layout?: {
    [k: string]: unknown;
  };
  scope: "shared" | "private";
  spec: QuerySpec;
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SavedViewList".
 */
export interface SavedViewList {
  views: SavedView[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SequenceStage".
 */
export interface SequenceStage {
  at: string;
  group_id?: string | null;
  rule_id?: string | null;
  stage: "recon" | "attack" | "impact";
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SharedNeighbor".
 */
export interface SharedNeighbor {
  count: number;
  id: string;
  label: string;
  relation: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SimilarRequest".
 */
export interface SimilarRequest {
  group_id: string;
  k?: number;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "SimilarResponse".
 */
export interface SimilarResponse {
  hits: SimilarHit[];
  /**
   * False when no embedding exists, so 'no hits' is not 'nothing similar'
   */
  measured?: boolean;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TimelinePoint".
 */
export interface TimelinePoint {
  bucket_start: string;
  bytes_out_max?: number | null;
  bytes_out_sum?: number | null;
  dims?: {
    [k: string]: string | null;
  };
  /**
   * None when not exactly measurable (merged rollups, no source column)
   */
  distinct_src_ips?: number | null;
  event_count: number;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TimelineRequest".
 */
export interface TimelineRequest {
  /**
   * @maxItems 20
   */
  filters?: FilterClause[];
  grain?: "1m" | "5m" | "1h";
  /**
   * @maxItems 3
   */
  group_by?: string[];
  index_name?: "http_activity" | "api_activity" | "authentication" | "audit_event" | "network_activity";
  window: TimeWindow;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TimelineResponse".
 */
export interface TimelineResponse {
  as_of: string;
  grain: "1m" | "5m" | "1h";
  /**
   * @maxItems 10
   */
  notes?: string[];
  /**
   * @maxItems 200000
   */
  points: TimelinePoint[];
  source: "rollup" | "raw";
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TriageRequest".
 */
export interface TriageRequest {
  kind?: ("detection" | "schedule" | "ask") | null;
  paging?: Paging;
  source?: string | null;
  state?: ("queued" | "launched" | "merged" | "expired") | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TriageResponse".
 */
export interface TriageResponse {
  rows: TriageRow[];
  strip: TriageStrip;
  unmeasured_text: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TriageRow".
 */
export interface TriageRow {
  age_seconds: number;
  case_id?: string | null;
  group_id?: string | null;
  id: string;
  kind: "detection" | "schedule" | "ask";
  last_quarter: boolean;
  severity: "info" | "low" | "medium" | "high" | "critical";
  source?: string | null;
  state: "queued" | "launched" | "merged" | "expired";
  ttl_seconds: number;
}
/**
 * Anything not yet computed is None and must render as 'unmeasured', never as zero.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "TriageStrip".
 */
export interface TriageStrip {
  cases_created_today: number;
  picked_up_share?: number | null;
  trust_floor?: number | null;
  /**
   * None when the count could not be completed (candidate cap hit)
   */
  waiting?: number | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WatchlistEntry".
 */
export interface WatchlistEntry {
  confidence?: number;
  expires_at?: string | null;
  note?: string;
  type: "ip" | "domain" | "url" | "hash" | "email";
  value: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WatchlistRequest".
 */
export interface WatchlistRequest {
  /**
   * @minItems 1
   * @maxItems 1000
   */
  entries: WatchlistEntry[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WatchlistResponse".
 */
export interface WatchlistResponse {
  accepted: number;
  bundle_key: string;
  rejected: {
    [k: string]: string;
  };
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhyBaseline".
 */
export interface WhyBaseline {
  endpoint?: string | null;
  historical_max_bytes?: number | null;
  history_days?: number | null;
  kind?: "baseline";
  /**
   * False renders as 'unmeasured', never as zero or empty
   */
  measured: boolean;
  multiple?: number | null;
  observed_bytes?: number | null;
  samples?: number | null;
  title: string;
}
/**
 * What the group's own events show. Paths, actions, sources and countries come from the SAMPLED events
 * (``events_sampled`` of ``events_total``); ``allowed`` and ``blocked`` are the group's exact totals.
 *
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhyEvidence".
 */
export interface WhyEvidence {
  /**
   * @maxItems 10
   */
  actions?: EvidenceAction[];
  allowed?: number | null;
  blocked?: number | null;
  bytes_max?: number | null;
  /**
   * False when no sampled event carries a response size
   */
  bytes_recorded: boolean;
  /**
   * @maxItems 5
   */
  countries?: Bucket[];
  distinct_countries?: number | null;
  distinct_src_ips?: number | null;
  events_sampled: number;
  events_total: number;
  first_seen?: string | null;
  last_seen?: string | null;
  /**
   * @maxItems 8
   */
  not_measured?: string[];
  /**
   * @maxItems 5
   */
  sensitive_paths?: string[];
  /**
   * @maxItems 5
   */
  sources?: Bucket[];
  /**
   * 2xx, 3xx, 4xx, 5xx counts; empty when unrecorded
   *
   * @maxItems 5
   */
  status_classes?: Bucket[];
  /**
   * False when no sampled event carries a response status
   */
  status_recorded: boolean;
  /**
   * @maxItems 5
   */
  top_paths?: Bucket[];
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhyGraph".
 */
export interface WhyGraph {
  kind?: "graph";
  /**
   * False renders as 'unmeasured', never as zero or empty
   */
  measured: boolean;
  /**
   * @maxItems 50
   */
  shared?: SharedNeighbor[];
  /**
   * @maxItems 50
   */
  techniques?: string[];
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhyIndicator".
 */
export interface WhyIndicator {
  kind?: "indicator";
  /**
   * @maxItems 50
   */
  matches?: IndicatorMatch[];
  /**
   * False renders as 'unmeasured', never as zero or empty
   */
  measured: boolean;
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhyNovelty".
 */
export interface WhyNovelty {
  kind?: "novelty";
  /**
   * False renders as 'unmeasured', never as zero or empty
   */
  measured: boolean;
  /**
   * Embedding model id
   */
  model?: string | null;
  /**
   * @maxItems 20
   */
  neighbors?: Neighbor[];
  novelty_class?: ("normal" | "drift" | "anomaly") | null;
  score?: number | null;
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhyResponse".
 */
export interface WhyResponse {
  as_of: string;
  evidence?: WhyEvidence | null;
  group_id: string;
  /**
   * @maxItems 12
   */
  sections: (WhyRule | WhyBaseline | WhySequence | WhyNovelty | WhyIndicator | WhyGraph)[];
  /**
   * Plain-language summary from fixed rules, not a model; states what was not measured
   */
  verdict?: string | null;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhyRule".
 */
export interface WhyRule {
  kind?: "rule";
  license?: string | null;
  matched?: string | null;
  /**
   * False renders as 'unmeasured', never as zero or empty
   */
  measured: boolean;
  /**
   * Third-party pack id; None for first-party rules
   */
  pack?: string | null;
  pack_commit?: string | null;
  rule_id?: string | null;
  title: string;
}
/**
 * This interface was referenced by `SiemContract`'s JSON-Schema
 * via the `definition` "WhySequence".
 */
export interface WhySequence {
  actor?: string | null;
  kind?: "sequence";
  /**
   * False renders as 'unmeasured', never as zero or empty
   */
  measured: boolean;
  proof?: boolean;
  /**
   * @maxItems 100
   */
  stages?: SequenceStage[];
  title: string;
}
