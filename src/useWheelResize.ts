import { useEffect, useRef, type MutableRefObject } from 'react';
import type { AnnotationHistory } from './history';
import type { Annotation, Defaults, Tool } from './types';

const MIN_SIZE = 2; // points
const IDLE_MS = 400; // a wheel spin with no tick for this long ends the undo step
const PER_PIXEL = Math.log(1.1) / 100; // one classic mouse notch (deltaY 100) = x1.1

interface Options {
  selectedIds: string[];
  tool: Tool;
  annotsRef: MutableRefObject<Annotation[]>;
  history: AnnotationHistory;
  setDefaults: (fn: (d: Defaults) => Defaults) => void;
  rememberSize: (a: Annotation) => void;
}

interface Gesture {
  /** the selection this gesture belongs to */
  key: string;
  /** annotations before the first tick: the single undo step goes back to this */
  base: Annotation[];
  /** latest values of the annotations (authoritative between renders) */
  cur: Annotation[];
  timer: number;
}

const scaled = (a: Annotation, f: number): Annotation => {
  if (a.type === 'stamp') {
    const k = clampFactor(f, a.w, a.h);
    return { ...a, w: a.w * k, h: a.h * k };
  }
  const k = clampFactor(f, a.size);
  return { ...a, size: a.size * k, lineHeight: a.lineHeight * k };
};

/** Scale factor, raised if needed so the smallest of `dims` doesn't drop below MIN_SIZE. */
const clampFactor = (f: number, ...dims: number[]) => Math.max(f, MIN_SIZE / Math.min(...dims));

/**
 * Alt + mouse wheel resizes things (Ctrl + wheel is zoom):
 *  - selected stamps: w/h scale together around their centre
 *  - selected text boxes: font size and line height scale together
 *    (with several selected, each mark scales by the same factor)
 *  - nothing selected, stamp tool active: the default size for that tool
 *    (the hover preview reads the defaults, so it resizes live)
 * Wheel up = bigger. A whole spin of the wheel on a selected annotation is ONE undo
 * step: ticks are transient updates, closed with a single checkpoint after IDLE_MS
 * of quiet (or when the selection changes, or just before any key / click).
 */
export function useWheelResize(opts: Options) {
  const o = useRef(opts);
  o.current = opts;
  const gesture = useRef<Gesture | null>(null);

  const flush = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    window.clearTimeout(g.timer);
    o.current.history.checkpoint(g.base);
    // Each kind (and text) remembers the size of the first mark of that kind.
    const seen = new Set<string>();
    for (const a of g.cur) {
      const k = a.type === 'stamp' ? a.kind : 'text';
      if (!seen.has(k)) {
        seen.add(k);
        o.current.rememberSize(a);
      }
    }
  };

  // Selection changed (or unmounting): close the open gesture.
  const selectionKey = opts.selectedIds.join(',');
  useEffect(() => () => flush(), [selectionKey]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault(); // never scroll the page while Alt is held

      const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!raw) return;
      const px = raw * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
      const f = Math.exp(-Math.max(-400, Math.min(400, px)) * PER_PIXEL);

      const { selectedIds, tool, annotsRef, history, setDefaults } = o.current;
      const key = selectedIds.join(',');

      if (gesture.current && gesture.current.key !== key) flush();
      const g = gesture.current;
      const ids = new Set(selectedIds);
      const sel = g ? g.cur : annotsRef.current.filter((a) => ids.has(a.id));

      if (sel.length) {
        const next = new Map(sel.map((a) => [a.id, scaled(a, f)]));
        const timer = window.setTimeout(flush, IDLE_MS);
        if (g) {
          window.clearTimeout(g.timer);
          g.cur = [...next.values()];
          g.timer = timer;
        } else {
          gesture.current = { key, base: annotsRef.current, cur: [...next.values()], timer };
        }
        history.update((all) => all.map((a) => next.get(a.id) ?? a), false);
      } else if (tool === 'circle' || tool === 'x' || tool === 'check' || tool === 'dot' || tool === 'strike') {
        setDefaults((d) => {
          const s = d.stamps[tool];
          const k = clampFactor(f, s.w, s.h);
          return { ...d, stamps: { ...d.stamps, [tool]: { ...s, w: s.w * k, h: s.h * k } } };
        });
      }
    };

    // Anything else (undo, delete, a click on a button...) must see a finished gesture.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') flush();
    };

    document.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', flush, true);
    return () => {
      document.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', flush, true);
    };
  }, []);
}
