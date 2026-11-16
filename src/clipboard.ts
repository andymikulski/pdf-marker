import type { Annotation, StampKind } from './types';

/**
 * Copy / cut / paste of marks. Pure helpers only: App wires them to the DOM
 * `copy` / `cut` / `paste` events.
 *
 * The marks travel as JSON in a custom clipboard type, and are also kept in
 * memory (module level, so they survive opening another PDF in the same session).
 */

export const CLIP_MIME = 'application/x-pdfmark+json';
/** pasted copies land this far (points) down and right of where the cascade starts */
export const PASTE_STEP = 12;

export interface ClipPayload {
  app: 'pdf-marker';
  version: 1;
  /** identifies one Ctrl+C / Ctrl+X, so repeated pastes of it can cascade */
  clipId: string;
  /** fingerprint of the document the marks came from */
  doc: string;
  /** the page they all came from, or -1 if they came from several */
  page: number;
  /** from a cut: the originals are gone, so the first paste back lands in place */
  cut: boolean;
  marks: Annotation[];
}

let memory: ClipPayload | null = null;
const pasteCounts = new Map<string, number>();

const KINDS: StampKind[] = ['circle', 'x', 'check', 'dot', 'strike'];
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function validMark(m: unknown): m is Annotation {
  if (!m || typeof m !== 'object') return false;
  const a = m as Record<string, unknown>;
  if (![a.x, a.y, a.w, a.h].every(isNum) || typeof a.color !== 'string') return false;
  if (a.type === 'stamp') return KINDS.includes(a.kind as StampKind) && isNum(a.stroke);
  if (a.type === 'text') return typeof a.text === 'string' && typeof a.font === 'string' && isNum(a.size) && isNum(a.lineHeight);
  return false;
}

export function parsePayload(raw: string | null | undefined): ClipPayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ClipPayload>;
    if (p?.app !== 'pdf-marker' || p.version !== 1 || !Array.isArray(p.marks) || !p.marks.length) return null;
    if (typeof p.clipId !== 'string' || !p.marks.every(validMark)) return null;
    return { ...(p as ClipPayload), doc: String(p.doc ?? ''), page: isNum(p.page) ? p.page! : -1, cut: !!p.cut };
  } catch {
    return null;
  }
}

/** Remember the marks in memory and return the payload (to also write to the system clipboard). */
export function makePayload(marks: Annotation[], doc: string, cut: boolean): ClipPayload {
  const pages = new Set(marks.map((m) => m.page));
  const payload: ClipPayload = {
    app: 'pdf-marker',
    version: 1,
    clipId: Math.random().toString(36).slice(2) + Date.now().toString(36),
    doc,
    page: pages.size === 1 ? marks[0].page : -1,
    cut,
    marks: marks.map((m) => ({ ...m })),
  };
  memory = payload;
  pasteCounts.clear();
  return payload;
}

/** Plain-text twin of the marks: the text of the text boxes, so pasting elsewhere gives something useful. */
export function plainText(marks: Annotation[]) {
  return marks.flatMap((m) => (m.type === 'text' ? [m.text] : [])).join('\n');
}

/** The marks to paste: the system clipboard's if it has valid ones, else the in-memory copy. */
export function readClip(data: DataTransfer | null): ClipPayload | null {
  return parsePayload(data?.getData(CLIP_MIME)) ?? memory;
}

/**
 * Copy the marks onto `page` (0-based) as new marks with fresh ids (and fresh seeds for stamps).
 *
 * - Same coordinates on another page; shifted PASTE_STEP down-right on the page they came from.
 * - Each further paste of the same clip onto the same page shifts another PASTE_STEP.
 * - The whole group is then nudged to stay inside the page.
 */
export function placeMarks(
  clip: ClipPayload,
  doc: string,
  page: number,
  pageSize: { width: number; height: number },
  boundsOf: (a: Annotation) => { x: number; y: number; w: number; h: number },
  newId: () => string,
  newSeed: () => number,
): Annotation[] {
  const key = `${clip.clipId}:${page}`;
  const n = pasteCounts.get(key) ?? 0;
  pasteCounts.set(key, n + 1);
  const fromHere = clip.doc === doc && clip.page === page && !clip.cut;
  const shift = PASTE_STEP * (n + (fromHere ? 1 : 0));

  const boxes = clip.marks.map(boundsOf);
  const lo = (k: 'x' | 'y') => Math.min(...boxes.map((b) => b[k])) + shift;
  const hi = (k: 'x' | 'y', len: 'w' | 'h') => Math.max(...boxes.map((b) => b[k] + b[len])) + shift;
  // Pull back inside the page; if the group is bigger than the page, keep its top-left visible.
  const fit = (min: number, max: number, size: number) => {
    const over = max > size ? size - max : 0;
    return over + Math.max(0, -(min + over));
  };
  const dx = shift + fit(lo('x'), hi('x', 'w'), pageSize.width);
  const dy = shift + fit(lo('y'), hi('y', 'h'), pageSize.height);

  return clip.marks.map(
    (m) => ({ ...m, id: newId(), page, x: m.x + dx, y: m.y + dy, ...(m.type === 'stamp' && { seed: newSeed() }) }) as Annotation,
  );
}
