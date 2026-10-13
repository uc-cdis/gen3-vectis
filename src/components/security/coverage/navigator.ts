import type { CoverageResponse, CoverageRow } from '@/lib/vectis-kit/spec';

type Verdict = CoverageRow['verdict'];
export const VERDICTS: readonly Verdict[] = ['both', 'rule', 'behavioral', 'missed'];

export const VERDICT_LABEL: Record<Verdict, string> = { both: 'Caught by both', rule: 'Rule only', behavioral: 'Behavioral only', missed: 'Missed' };
export const VERDICT_MEANING: Record<Verdict, string> = {
  both: 'Detected by a rule and by behavioral detection.',
  rule: 'Detected by a rule only.',
  behavioral: 'Detected by behavioral detection only.',
  missed: 'Replayed, but nothing detected it.',
};
/** Mantine colour (for the UI) and hex (for the Navigator layer) per verdict. The label is always shown too. */
export const VERDICT_COLOR: Record<Verdict, string> = { both: 'teal', rule: 'blue', behavioral: 'violet', missed: 'red' };
const VERDICT_HEX: Record<Verdict, string> = { both: '#2f9e44', rule: '#1c7ed6', behavioral: '#7048e8', missed: '#e03131' };
const SCORE: Record<Verdict, number> = { both: 100, behavioral: 75, rule: 50, missed: 0 };
const STRENGTH: Record<Verdict, number> = { missed: 0, rule: 1, behavioral: 1, both: 2 };

export const TECHNIQUE_ID = /^T\d{4}(\.\d{3})?$/;
const REPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface NavigatorTechnique { techniqueID: string; score: number; color: string; comment: string; enabled: true }
interface NavigatorLayer {
  name: string;
  versions: { navigator: string; layer: string };
  domain: 'enterprise-attack';
  description: string;
  sorting: 0;
  layout: { layout: 'side'; showID: true; showName: true };
  hideDisabled: false;
  techniques: NavigatorTechnique[];
  gradient: { colors: string[]; minValue: number; maxValue: number };
  legendItems: { label: string; color: string }[];
  showTooltips: true;
}
interface LayerResult { layer: NavigatorLayer; included: number; rejected: number }

const isValidRow = (r: CoverageRow): boolean =>
  typeof r?.technique_id === 'string' && TECHNIQUE_ID.test(r.technique_id) &&
  typeof r.verdict === 'string' && (VERDICTS as readonly string[]).includes(r.verdict) &&
  typeof r.replay === 'string' && REPLAY_NAME.test(r.replay);

/**
 * Build an ATT&CK Navigator layer (layer format 4.5). Pure and deterministic.
 * Only technique ids, verdicts and replay names ever reach the output. Rows that fail validation are dropped
 * and counted so the caller can say so. A technique replayed more than once appears once, with its weakest verdict.
 */
export function buildNavigatorLayer(cov: Pick<CoverageResponse, 'rows' | 'run_at'>): LayerResult {
  const byTechnique = new Map<string, CoverageRow[]>();
  let rejected = 0;
  for (const row of cov.rows) {
    if (!isValidRow(row)) { rejected += 1; continue; }
    const list = byTechnique.get(row.technique_id) ?? [];
    list.push(row);
    byTechnique.set(row.technique_id, list);
  }
  const techniques: NavigatorTechnique[] = [...byTechnique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([techniqueID, rows]) => {
      const weakest = rows.reduce((w, r) => (STRENGTH[r.verdict] < STRENGTH[w.verdict] ? r : w));
      return {
        techniqueID,
        score: SCORE[weakest.verdict],
        color: VERDICT_HEX[weakest.verdict],
        comment: rows.map((r) => `${VERDICT_LABEL[r.verdict]} (replay ${r.replay})`).join('; '),
        enabled: true as const,
      };
    });
  const runDate = Number.isNaN(Date.parse(cov.run_at)) ? null : new Date(cov.run_at).toISOString().slice(0, 10);
  const layer: NavigatorLayer = {
    name: runDate ? `Vectis detection coverage ${runDate}` : 'Vectis detection coverage',
    versions: { navigator: '5.1.0', layer: '4.5' },
    domain: 'enterprise-attack',
    description: 'Detection coverage measured by replaying known attack steps against the Vectis detectors.',
    sorting: 0,
    layout: { layout: 'side', showID: true, showName: true },
    hideDisabled: false,
    techniques,
    gradient: { colors: [VERDICT_HEX.missed, VERDICT_HEX.both], minValue: 0, maxValue: 100 },
    legendItems: VERDICTS.map((v) => ({ label: VERDICT_LABEL[v], color: VERDICT_HEX[v] })),
    showTooltips: true,
  };
  return { layer, included: techniques.length, rejected };
}
