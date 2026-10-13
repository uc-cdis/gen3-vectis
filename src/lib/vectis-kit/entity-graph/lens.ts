import type { GraphNode } from '../spec';
import { safeText } from '@/lib/safe-text';

/** Shapes ECharts can draw for a node. Shape is the second cue (after colour) that tells node kinds apart. */
type GraphSymbol = 'circle' | 'rect' | 'roundRect' | 'triangle' | 'diamond' | 'pin';

interface LabelStyle {
  color: string;
  symbol: GraphSymbol;
  /** Which node property is the human title, e.g. "path" for an endpoint. Falls back to the lens defaults, then to the id. */
  titleProperty?: string;
}

/**
 * A lens says how a dictionary's labels look. Security supplies one, genomics another; any label that is not
 * listed still gets a stable colour and shape derived from its name, so the graph works for any dictionary.
 */
export interface Lens {
  labels?: Readonly<Record<string, Partial<LabelStyle>>>;
  /** Property names tried in order to find a node title when the label has no titleProperty. */
  titleProperties?: readonly string[];
}

const DEFAULT_TITLE_PROPERTIES: readonly string[] = ['name', 'title', 'value', 'path', 'org', 'label'];

// The Gen3 chart palette (colour-blind friendly), so the graph matches the other charts.
const PALETTE = ['#0173B2', '#DE8F05', '#029E73', '#CC78BC', '#CA9161', '#56B4E9', '#D55E00', '#7A7A7A', '#8C2D04', '#1B9E77'] as const;
const SYMBOLS: readonly GraphSymbol[] = ['circle', 'rect', 'diamond', 'triangle', 'roundRect', 'pin'];

/** FNV-1a. Stable across runs and platforms, which is the point: the same label is always the same colour. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function styleFor(lens: Lens | undefined, label: string): LabelStyle {
  const h = hashString(label);
  const base: LabelStyle = {
    color: PALETTE[h % PALETTE.length] as string,
    symbol: SYMBOLS[(h >>> 8) % SYMBOLS.length] as GraphSymbol,
  };
  const own = lens?.labels && Object.hasOwn(lens.labels, label) ? lens.labels[label] : undefined;
  return { ...base, ...own };
}

/** `tenant1:IpAddress:203.0.113.50` -> `203.0.113.50`. Ids that do not follow `<tenant>:<Label>:<key>` are returned unchanged. */
export function displayId(id: string, label?: string): string {
  const parts = id.split(':');
  if (parts.length >= 3 && (label === undefined || parts[1] === label)) return parts.slice(2).join(':');
  return id;
}

/** The node's human title, untruncated. Always text. */
export function nodeTitle(node: GraphNode, lens?: Lens): string {
  const own = styleFor(lens, node.label).titleProperty;
  const candidates = [...(own ? [own] : []), ...(lens?.titleProperties ?? DEFAULT_TITLE_PROPERTIES)];
  const props = node.properties ?? {};
  for (const key of candidates) {
    if (!Object.hasOwn(props, key)) continue;
    const v = props[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  return displayId(node.id, node.label);
}

/** Title as safe, short text for tables and panels. */
export const nodeTitleText = (node: GraphNode, lens?: Lens, max = 80): string => safeText(nodeTitle(node, lens), max);
