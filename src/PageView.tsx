import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { StampGraphic, TextGraphic, bounds } from './Annot';
import { cssFont, editorMetrics, layoutText } from './fonts';
import { resizeStamp } from './geometry';
import { newSeed, type Annotation, type Defaults, type PageInfo, type StampAnnotation, type StampKind, type TextAnnotation, type Tool } from './types';

export interface PageCtl {
  tool: Tool;
  zoom: number;
  defaults: Defaults;
  /** ids of the selected marks (any number, on any page) */
  selected: ReadonlySet<string>;
  editingId: string | null;
  getAnnots(): Annotation[];
  update(fn: (a: Annotation[]) => Annotation[], commit?: boolean): void;
  checkpoint(base: Annotation[]): void;
  select(ids: string[]): void;
  startEdit(id: string, base: Annotation[]): void;
  finishEdit(): void;
  /** called after a resize so the new size becomes the default for that kind */
  rememberSize(a: Annotation): void;
}

type Drag =
  /** drag one mark, or the whole selection (`origs`: each moved mark as it was at pointer-down) */
  | {
      mode: 'move';
      id: string;
      origs: Annotation[];
      start: [number, number];
      base: Annotation[];
      moved: boolean;
      editOnClick: boolean;
      /** a plain click (no drag) on a member of a group narrows the selection to just that mark */
      collapseOnClick: boolean;
    }
  | { mode: 'resize'; id: string; orig: Annotation; base: Annotation[] }
  /** drawing a cross-out: it spans the drag horizontally; a click leaves the default width */
  | { mode: 'strike'; id: string; start: [number, number]; orig: StampAnnotation; base: Annotation[]; moved: boolean }
  | { mode: 'box'; start: [number, number]; cur: [number, number] }
  /** rubber-band selection (select tool, empty space); `keep` = the selection to add to (Shift/Ctrl) */
  | { mode: 'marquee'; start: [number, number]; keep: string[]; additive: boolean; moved: boolean };

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const isStampTool = (t: Tool): t is StampKind => t !== 'select' && t !== 'text';
const MAX_CANVAS_PIXELS = 24_000_000;

interface Props {
  index: number;
  info: PageInfo;
  doc: PDFDocumentProxy;
  annots: Annotation[];
  ctl: PageCtl;
  scrollRoot: HTMLElement | null;
}

export function PageView({ index, info, doc, annots, ctl, scrollRoot }: Props) {
  const { zoom, tool, defaults } = ctl;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [boxPreview, setBoxPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Render lazily: only once the page is near the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      root: scrollRoot,
      rootMargin: '1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const canvas = canvasRef.current!;
      let scale = zoom * (window.devicePixelRatio || 1);
      const px = info.width * info.height * scale * scale;
      if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);
      const vp = page.getViewport({ scale });
      // Render offscreen, then swap, so zooming doesn't flash white.
      const off = document.createElement('canvas');
      off.width = Math.ceil(vp.width);
      off.height = Math.ceil(vp.height);
      task = page.render({ canvas: off, canvasContext: off.getContext('2d')!, viewport: vp });
      try {
        await task.promise;
      } catch {
        return; // cancelled
      }
      if (cancelled) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d')!.drawImage(off, 0, 0);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, zoom, doc, index, info.width, info.height]);

  const toPage = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };

  const replace = (id: string, fn: (a: Annotation) => Annotation) =>
    ctl.update((all) => all.map((a) => (a.id === id ? fn(a) : a)), false);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const pt = toPage(e);
    const target = e.target as Element;
    const handleId = target.closest('[data-handle]')?.getAttribute('data-handle');
    const annId = target.closest('[data-id]')?.getAttribute('data-id');
    const all = ctl.getAnnots();
    svgRef.current!.setPointerCapture(e.pointerId);
    e.preventDefault();

    if (ctl.editingId) ctl.finishEdit();

    if (handleId) {
      const orig = all.find((a) => a.id === handleId);
      if (orig) drag.current = { mode: 'resize', id: handleId, orig, base: all };
      return;
    }

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (annId && !(e.altKey && tool !== 'select')) {
      const orig = all.find((a) => a.id === annId)!;
      const current = [...ctl.selected];
      const wasSelected = ctl.selected.has(annId);
      let ids: string[];
      if (additive) {
        // Shift/Ctrl+click toggles this mark in or out of the selection.
        ids = wasSelected ? current.filter((id) => id !== annId) : [...current, annId];
        ctl.select(ids);
        if (wasSelected) return; // just removed it: nothing to drag
      } else if (wasSelected) {
        ids = current; // keep the group so it can be dragged as one
      } else {
        ids = [annId];
        ctl.select(ids);
      }
      const set = new Set(ids);
      drag.current = {
        mode: 'move',
        id: annId,
        origs: all.filter((a) => set.has(a.id)),
        start: pt,
        base: all,
        moved: false,
        // With the text tool, clicking a text box edits it straight away.
        editOnClick: !additive && orig.type === 'text' && tool === 'text',
        collapseOnClick: !additive && wasSelected && ids.length > 1,
      };
      return;
    }

    if (isStampTool(tool)) {
      const d = defaults.stamps[tool];
      const a: StampAnnotation = {
        id: newId(),
        type: 'stamp',
        kind: tool,
        page: index,
        color: defaults.color,
        x: pt[0],
        y: pt[1],
        w: d.w,
        h: d.h,
        stroke: d.stroke,
        rough: defaults.hand.on ? defaults.hand.amount : 0,
        seed: newSeed(),
        ...(tool === 'strike' && { strike: defaults.strike.style }),
      };
      ctl.update((list) => [...list, a], false);
      ctl.select([a.id]);
      if (tool === 'strike') {
        drag.current = { mode: 'strike', id: a.id, start: pt, orig: a, base: all, moved: false };
        return;
      }
      // Keep dragging the fresh stamp until release; the whole thing is one undo step.
      drag.current = { mode: 'move', id: a.id, origs: [a], start: pt, base: all, moved: true, editOnClick: false, collapseOnClick: false };
      return;
    }

    if (tool === 'text') {
      drag.current = { mode: 'box', start: pt, cur: pt };
      return;
    }

    // Select tool on empty space: a click clears the selection, a drag draws a marquee.
    // (Shift/Ctrl keeps the current selection and adds to it.)
    if (!additive) ctl.select([]);
    drag.current = { mode: 'marquee', start: pt, keep: additive ? [...ctl.selected] : [], additive, moved: false };
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const pt = toPage(e);
    const d = drag.current;
    if (!d) {
      setHover(pt);
      return;
    }
    if (d.mode === 'move') {
      const dx = pt[0] - d.start[0];
      const dy = pt[1] - d.start[1];
      if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
      d.moved = true;
      const orig = new Map(d.origs.map((o) => [o.id, o]));
      ctl.update((all) => all.map((a) => { const o = orig.get(a.id); return o ? { ...o, x: o.x + dx, y: o.y + dy } : a; }), false);
    } else if (d.mode === 'marquee') {
      if (!d.moved && Math.hypot(pt[0] - d.start[0], pt[1] - d.start[1]) * zoom < 3) return;
      d.moved = true;
      const r = rectFrom(d.start, pt);
      setBoxPreview(r);
      const hit = annots.filter((a) => intersects(bounds(a), r)).map((a) => a.id);
      ctl.select(d.additive ? [...new Set([...d.keep, ...hit])] : hit);
    } else if (d.mode === 'strike') {
      const dx = pt[0] - d.start[0];
      if (!d.moved && Math.abs(dx) * zoom < 4) return;
      d.moved = true;
      // Horizontal span from where the drag started to where it is now.
      const w = Math.max(2, Math.abs(dx));
      replace(d.id, () => ({ ...d.orig, x: (d.start[0] + pt[0]) / 2, y: (d.start[1] + pt[1]) / 2, w }));
    } else if (d.mode === 'resize') {
      const o = d.orig;
      if (o.type === 'stamp') {
        // Proportional by default; hold Shift, Ctrl or Alt to stretch freely
        // (e.g. an oval around a wide word). Cross-outs always stretch freely:
        // their length and thickness are independent.
        const free = o.kind === 'strike' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey;
        const { w, h } = resizeStamp(o, pt, free);
        replace(d.id, () => ({ ...o, w, h }));
      } else {
        const w = Math.max(20, pt[0] - o.x);
        const h = Math.max(o.lineHeight, pt[1] - o.y);
        replace(d.id, () => ({ ...o, w, h }));
      }
    } else {
      d.cur = pt;
      setBoxPreview(rectFrom(d.start, d.cur));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'move') {
      if (d.moved) ctl.checkpoint(d.base);
      else if (d.editOnClick) ctl.startEdit(d.id, d.base);
      else if (d.collapseOnClick) ctl.select([d.id]);
    } else if (d.mode === 'marquee') {
      setBoxPreview(null);
    } else if (d.mode === 'strike') {
      ctl.checkpoint(d.base);
    } else if (d.mode === 'resize') {
      ctl.checkpoint(d.base);
      const cur = ctl.getAnnots().find((a) => a.id === d.id);
      if (cur) ctl.rememberSize(cur);
    } else {
      setBoxPreview(null);
      const base = ctl.getAnnots();
      const t = defaults.text;
      const r = rectFrom(d.start, d.cur);
      const dragged = r.w * zoom > 8 || r.h * zoom > 8;
      const a: TextAnnotation = {
        id: newId(),
        type: 'text',
        page: index,
        color: defaults.color,
        font: t.font,
        size: t.size,
        lineHeight: t.lineHeight,
        text: '',
        ...(dragged
          ? { x: r.x, y: r.y, w: Math.max(20, r.w), h: Math.max(t.lineHeight, r.h) }
          : { x: d.start[0], y: d.start[1] - t.lineHeight / 2, w: t.w, h: t.lineHeight }),
      };
      ctl.update((list) => [...list, a], false);
      ctl.select([a.id]);
      ctl.startEdit(a.id, base);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
    const a = id && ctl.getAnnots().find((x) => x.id === id);
    if (a && a.type === 'text') ctl.startEdit(a.id, ctl.getAnnots());
  };

  const selected = annots.filter((a) => ctl.selected.has(a.id));
  const single = ctl.selected.size === 1; // the resize handle only makes sense for one mark
  const editing = annots.find((a) => a.id === ctl.editingId) as TextAnnotation | undefined;
  const hs = 9 / zoom; // handle size, constant on screen

  const ghost: StampAnnotation | null =
    hover && isStampTool(tool) && !drag.current
      ? {
          id: 'ghost',
          type: 'stamp',
          kind: tool,
          page: index,
          color: defaults.color,
          x: hover[0],
          y: hover[1],
          ...defaults.stamps[tool],
          rough: defaults.hand.on ? defaults.hand.amount : 0,
          seed: 7,
          ...(tool === 'strike' && { strike: defaults.strike.style }),
        }
      : null;

  return (
    <div className="page" ref={wrapRef} style={{ width: info.width * zoom, height: info.height * zoom }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <svg
        ref={svgRef}
        className={`overlay tool-${tool}`}
        viewBox={`0 0 ${info.width} ${info.height}`}
        width={info.width * zoom}
        height={info.height * zoom}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
      >
        {annots.map((a) => {
          const b = bounds(a);
          return (
            <g key={a.id} data-id={a.id} className="annot">
              {a.type === 'stamp' && a.kind === 'strike' ? (
                // cross-outs are thin: give them a taller hit target so they're easy to grab
                <rect x={b.x} y={Math.min(b.y, b.y + b.h / 2 - 5)} width={b.w} height={Math.max(b.h, 10)} className="hit" />
              ) : (
                <rect x={b.x} y={b.y} width={b.w} height={b.h} className="hit" />
              )}
              {a.type === 'stamp' ? <StampGraphic a={a} /> : <TextGraphic a={a} hideText={a.id === ctl.editingId} />}
              {a.type === 'text' && !ctl.selected.has(a.id) && (
                <rect x={b.x} y={b.y} width={b.w} height={b.h} className="text-guide" />
              )}
            </g>
          );
        })}
        {ghost && !(hover && annots.some((a) => inBounds(a, hover))) && <StampGraphic a={ghost} opacity={0.35} />}
        {selected.map((a) => <Selection key={a.id} a={a} hs={hs} zoom={zoom} handle={single} />)}
        {boxPreview && <rect {...{ x: boxPreview.x, y: boxPreview.y, width: boxPreview.w, height: boxPreview.h }} className="box-preview" />}
      </svg>
      {editing && <TextEditor a={editing} zoom={zoom} ctl={ctl} />}
      <div className="page-label">{index + 1}</div>
    </div>
  );
}

function Selection({ a, hs, zoom, handle }: { a: Annotation; hs: number; zoom: number; handle: boolean }) {
  const b = bounds(a);
  const pad = 2 / zoom;
  return (
    <g>
      <rect
        x={b.x - pad}
        y={b.y - pad}
        width={b.w + pad * 2}
        height={b.h + pad * 2}
        className="sel-outline"
        strokeWidth={1 / zoom}
        strokeDasharray={`${4 / zoom} ${3 / zoom}`}
      />
      {handle && (
        <rect
          data-handle={a.id}
          x={b.x + b.w + pad - hs / 2}
          y={b.y + b.h + pad - hs / 2}
          width={hs}
          height={hs}
          className="sel-handle"
          strokeWidth={1 / zoom}
        />
      )}
    </g>
  );
}

function TextEditor({ a, zoom, ctl }: { a: TextAnnotation; zoom: number; ctl: PageCtl }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [a.id]);
  // Align the textarea's baselines with our layout (line sits on the bottom of its band).
  const { asc, desc, descent } = editorMetrics(a.font);
  const delta = a.lineHeight / 2 - ((asc - desc) / 2) * a.size - descent * a.size;
  const lines = layoutText(a).length;
  const h = Math.max(a.h, (lines + (a.text.endsWith('\n') ? 1 : 0)) * a.lineHeight);
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={a.text}
      spellCheck
      style={{
        left: a.x * zoom,
        top: a.y * zoom,
        width: a.w * zoom,
        height: h * zoom,
        paddingTop: Math.max(0, delta * zoom),
        marginTop: Math.min(0, delta * zoom),
        fontFamily: cssFont(a.font),
        fontSize: a.size * zoom,
        lineHeight: `${a.lineHeight * zoom}px`,
        color: a.color,
      }}
      onChange={(e) => {
        const text = e.target.value;
        ctl.update((all) => all.map((x) => (x.id === a.id ? { ...x, text } : x)), false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          ctl.finishEdit();
        }
        e.stopPropagation();
      }}
      onBlur={() => ctl.finishEdit()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function rectFrom(a: [number, number], b: [number, number]) {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

function intersects(b: { x: number; y: number; w: number; h: number }, r: { x: number; y: number; w: number; h: number }) {
  return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
}

function inBounds(a: Annotation, p: [number, number]) {
  const b = bounds(a);
  return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
}
