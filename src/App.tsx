import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bounds } from './Annot';
import { CLIP_MIME, makePayload, placeMarks, plainText, readClip } from './clipboard';
import { loadPdf, type LoadedPdf } from './pdf';
import { PROJECT_EXT, extractProject, isProjectFile, parseProjectFile, serializeProjectFile } from './project';
import { exportRaster, exportVector } from './exporter';
import { useAnnotationHistory } from './history';
import { Inspector } from './Inspector';
import { PageView, newId, type PageCtl } from './PageView';
import { loadDefaults, loadDocAnnotations, saveDefaults, saveDocAnnotations } from './storage';
import { newSeed, type Annotation, type Defaults, type StampAnnotation, type Tool } from './types';
import { useSpacePan } from './useSpacePan';
import { useWheelResize } from './useWheelResize';

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: <path d="M5 3l12 9-5.5 1L9 19z" fill="currentColor" /> },
  { id: 'circle', label: 'Circle', key: 'C', icon: <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /> },
  { id: 'x', label: 'X mark', key: 'X', icon: <path d="M5 5l12 12M17 5L5 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /> },
  { id: 'check', label: 'Check', key: 'K', icon: <path d="M4 12l4.5 5L18 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /> },
  { id: 'dot', label: 'Filled dot', key: 'D', icon: <circle cx="11" cy="11" r="5.5" fill="currentColor" /> },
  { id: 'strike', label: 'Cross-out', key: 'S', icon: <path d="M3 11h16M5 6.5h4M12 6.5h5M5 15.5h6M14 15.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /> },
  { id: 'text', label: 'Text box', key: 'T', icon: <path d="M5 5h12M11 5v13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /> },
];
const KEY_TO_TOOL = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
/** a patch for every selected mark, or a function giving each mark its own patch */
export type Patch = Partial<Annotation> | ((a: Annotation) => Partial<Annotation>);
/** properties that, when changed, also update the defaults for new marks */
const SIZE_KEYS = ['w', 'h', 'stroke', 'font', 'size', 'lineHeight'];
const REEDITABLE_KEY = 'pdf-marker:reeditable';

interface FileKind {
  description: string;
  mime: string;
  ext: string;
}
const PDF_TYPE: FileKind = { description: 'PDF', mime: 'application/pdf', ext: '.pdf' };
const PROJECT_TYPE: FileKind = { description: 'PDF Marker project', mime: 'application/x-pdfmark', ext: PROJECT_EXT };

/**
 * Save a file: straight to `handle` if we have one (and may write it), else via
 * the native save dialog, else as a browser download. Returns the handle used,
 * or null for a download.
 */
async function saveBlob(blob: Blob, suggestedName: string, kind: FileKind, handle?: FileSystemFileHandle | null) {
  const write = async (h: FileSystemFileHandle) => {
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    return h;
  };
  if (handle) {
    try {
      return await write(handle);
    } catch (err) {
      console.warn('Could not write to the existing file, asking where to save', err);
    }
  }
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker;
  if (picker) {
    const h = await picker({ suggestedName, types: [{ description: kind.description, accept: { [kind.mime]: [kind.ext] } }] });
    return write(h);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}
const ZOOMS =[0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export function App() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [fileName, setFileName] = useState('');
  const [zoom, setZoom] = useState(1.25);
  const [tool, setTool] = useState<Tool>('circle');
  const [defaults, setDefaultsState] = useState<Defaults>(loadDefaults);
  /** ids of the selected marks, in the order they were picked */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [reeditable, setReeditable] = useState(() => localStorage.getItem(REEDITABLE_KEY) !== '0');
  /** the .pdfmark file this session saves to (handle is null if we can't write it directly) */
  const [projectFile, setProjectFile] = useState<{ name: string; handle: FileSystemFileHandle | null } | null>(null);
  /** annotations as of the last project save/open, for the unsaved-changes dot */
  const [savedAnnots, setSavedAnnots] = useState<Annotation[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const history = useAnnotationHistory();
  const { annots } = history;
  const annotsRef = useRef(annots);
  annotsRef.current = annots;
  const editRef = useRef<{ id: string; base: Annotation[] } | null>(null);

  // Drop ids of marks that no longer exist (deleted, or gone after undo/redo).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.length) return prev;
      const exist = new Set(annots.map((a) => a.id));
      const next = prev.filter((id) => exist.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [annots]);

  const setDefaults = useCallback((fn: (d: Defaults) => Defaults) => {
    setDefaultsState((d) => {
      const next = fn(d);
      saveDefaults(next);
      return next;
    });
  }, []);

  // ---- open -------------------------------------------------------------
  const openFile = useCallback(
    async (file: File, handle?: FileSystemFileHandle) => {
      setStatus(`Opening ${file.name}…`);
      try {
        const fileBytes = new Uint8Array(await file.arrayBuffer());
        // Either a .pdfmark project file, a PDF exported by this app with its
        // original + editable marks embedded, or a plain PDF.
        const fromProjectFile = isProjectFile(file.name, fileBytes);
        const project = fromProjectFile ? parseProjectFile(fileBytes) : await extractProject(fileBytes);
        const loaded = await loadPdf(project ? project.original : fileBytes);
        void pdf?.doc.loadingTask.destroy();
        editRef.current = null;
        setEditingId(null);
        setSelectedIds([]);
        setPdf(loaded);
        setFileName(project ? project.data.name : file.name);
        const saved = project ? project.data.annots : loadDocAnnotations(loaded.fingerprint);
        history.reset(saved);
        setProjectFile(fromProjectFile ? { name: file.name, handle: handle ?? null } : null);
        setSavedAnnots(fromProjectFile ? saved : null);
        // Fit page width to the viewport.
        // Leave room for the page padding and a vertical scrollbar that may appear.
        const avail = (scrollEl?.clientWidth ?? 900) - 80;
        const maxW = Math.max(...loaded.pages.map((p) => p.width));
        setZoom(Math.min(2.5, Math.max(0.5, Math.round((avail / maxW) * 20) / 20)));
        scrollEl?.scrollTo(0, 0);
        setStatus(
          fromProjectFile
            ? `Opened project ${file.name}: ${saved.length} marks on ${project!.data.name}.`
            : project
            ? `Reopened ${file.name} as an editable project: ${saved.length} marks restored over the original ${project.data.name}.`
            : saved.length
              ? `Restored ${saved.length} marks from your last session.`
              : null,
        );
      } catch (err) {
        console.error(err);
        setStatus(`Couldn't open ${file.name}: ${(err as Error).message}`);
      }
    },
    [pdf, history, scrollEl],
  );

  // ---- autosave ---------------------------------------------------------
  useEffect(() => {
    if (!pdf) return;
    const t = setTimeout(() => saveDocAnnotations(pdf.fingerprint, fileName, annots), 300);
    return () => clearTimeout(t);
  }, [annots, pdf, fileName]);

  // ---- export -----------------------------------------------------------
  const exportPdf = useCallback(async () => {
    if (!pdf) return;
    if (editRef.current) finishEditRef.current();
    const list = annotsRef.current;
    setStatus('Exporting…');
    let out: Uint8Array;
    let note = '';
    const project = reeditable
      ? { original: pdf.bytes, data: { version: 1 as const, name: fileName, annots: list } }
      : undefined;
    try {
      out = await exportVector(pdf.bytes, pdf.pages, list, project);
    } catch (err) {
      console.warn('Vector export failed, falling back to raster', err);
      out = await exportRaster(pdf.doc, pdf.pages, list, project);
      note = ' (pages were flattened to images because the original PDF could not be edited directly)';
    }
    const name = fileName.replace(/\.pdf$/i, '').replace(/-filled$/i, '') + '-filled.pdf';
    const blob = new Blob([out as BlobPart], { type: 'application/pdf' });
    try {
      const h = await saveBlob(blob, name, PDF_TYPE);
      setStatus(`Exported ${h?.name ?? name}${note}${reeditable ? '. Open it here again to keep editing.' : ''}`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') setStatus(null);
      else setStatus(`Export failed: ${(err as Error).message}`);
    }
  }, [pdf, fileName, reeditable]);

  // ---- projects ---------------------------------------------------------
  const saveProject = useCallback(
    async (saveAs = false) => {
      if (!pdf) return;
      if (editRef.current) finishEditRef.current();
      const list = annotsRef.current;
      const blob = serializeProjectFile({ original: pdf.bytes, data: { version: 1, name: fileName, annots: list } });
      const suggested = projectFile?.name ?? fileName.replace(/\.pdf$/i, '') + PROJECT_EXT;
      try {
        const h = await saveBlob(blob, suggested, PROJECT_TYPE, saveAs ? null : projectFile?.handle);
        setProjectFile({ name: h?.name ?? suggested, handle: h });
        setSavedAnnots(list);
        setStatus(`Saved project ${h?.name ?? suggested} (${list.length} marks)`);
      } catch (err) {
        if ((err as Error).name === 'AbortError') setStatus(null);
        else setStatus(`Save failed: ${(err as Error).message}`);
      }
    },
    [pdf, fileName, projectFile],
  );

  const openDialog = useCallback(async () => {
    const picker = (window as unknown as { showOpenFilePicker?: (o: object) => Promise<FileSystemFileHandle[]> })
      .showOpenFilePicker;
    if (!picker) return fileInput.current?.click();
    try {
      const [h] = await picker({
        types: [
          {
            description: 'PDF or PDF Marker project',
            accept: { 'application/pdf': ['.pdf'], 'application/x-pdfmark': [PROJECT_EXT] },
          },
        ],
      });
      await openFile(await h.getFile(), h);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setStatus(`Couldn't open: ${(err as Error).message}`);
    }
  }, [openFile]);

  // ---- editing ----------------------------------------------------------
  const startEdit = useCallback((id: string, base: Annotation[]) => {
    editRef.current = { id, base };
    setSelectedIds([id]);
    setEditingId(id);
  }, []);

  const finishEdit = useCallback(() => {
    const e = editRef.current;
    if (!e) return;
    editRef.current = null;
    setEditingId(null);
    const cur = annotsRef.current.find((a) => a.id === e.id);
    const existedBefore = e.base.some((a) => a.id === e.id);
    if (cur?.type === 'text' && cur.text.trim() === '') {
      history.update((all) => all.filter((a) => a.id !== e.id), false);
      if (existedBefore) history.checkpoint(e.base);
      setSelectedIds((ids) => ids.filter((x) => x !== e.id));
      return;
    }
    history.checkpoint(e.base);
  }, [history]);
  const finishEditRef = useRef(finishEdit);
  finishEditRef.current = finishEdit;

  const rememberSize = useCallback(
    (a: Annotation) => {
      if (a.type === 'stamp') {
        setDefaults((d) => ({ ...d, stamps: { ...d.stamps, [a.kind]: { w: a.w, h: a.h, stroke: a.stroke } } }));
      } else {
        setDefaults((d) => ({ ...d, text: { ...d.text, font: a.font, size: a.size, lineHeight: a.lineHeight } }));
      }
    },
    [setDefaults],
  );

  /**
   * Apply a change to every selected mark (optionally only those passing `only`) as ONE
   * undo step. `patch` may be a function for per-mark values (e.g. scaling, new seeds).
   */
  const patchSelected = useCallback(
    (patch: Patch, only?: (a: Annotation) => boolean) => {
      const ids = new Set(selectedIds);
      // Compute the results up front: the reducer callback runs later, during
      // React's next render, so anything it assigns isn't available here yet.
      const patches = new Map<string, Partial<Annotation>>();
      const changed: Annotation[] = [];
      for (const a of annotsRef.current) {
        if (!ids.has(a.id) || (only && !only(a))) continue;
        const p = typeof patch === 'function' ? patch(a) : patch;
        patches.set(a.id, p);
        changed.push({ ...a, ...p } as Annotation);
      }
      if (!changed.length) return;
      history.update((all) => all.map((a) => (patches.has(a.id) ? ({ ...a, ...patches.get(a.id) } as Annotation) : a)));
      // New stamps/text of this kind now use the size you just set. With several
      // marks selected, the first one of each kind wins, and only when a size-ish
      // property changed (a colour change shouldn't reset the defaults).
      const sizeish = changed.length === 1 || [...patches.values()].some((p) => SIZE_KEYS.some((k) => k in p));
      if (!sizeish) return;
      const seen = new Set<string>();
      for (const a of changed) {
        const k = a.type === 'stamp' ? a.kind : 'text';
        if (!seen.has(k)) {
          seen.add(k);
          rememberSize(a);
        }
      }
    },
    [selectedIds, history, rememberSize],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    editRef.current = null;
    setEditingId(null);
    const ids = new Set(selectedIds);
    history.update((all) => all.filter((a) => !ids.has(a.id)));
    setSelectedIds([]);
  }, [selectedIds, history]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const ctl: PageCtl = useMemo(
    () => ({
      tool,
      zoom,
      defaults,
      selected: selectedSet,
      editingId,
      getAnnots: () => annotsRef.current,
      update: history.update,
      checkpoint: history.checkpoint,
      select: setSelectedIds,
      startEdit,
      finishEdit,
      rememberSize,
    }),
    [tool, zoom, defaults, selectedSet, editingId, history.update, history.checkpoint, startEdit, finishEdit, rememberSize],
  );

  // ---- zoom -------------------------------------------------------------
  const zoomTo = useCallback(
    (next: number) => {
      const el = scrollEl;
      const z = Math.min(5, Math.max(0.25, next));
      if (el) {
        const cx = (el.scrollLeft + el.clientWidth / 2) / zoom;
        const cy = (el.scrollTop + el.clientHeight / 2) / zoom;
        requestAnimationFrame(() => {
          el.scrollLeft = cx * z - el.clientWidth / 2;
          el.scrollTop = cy * z - el.clientHeight / 2;
        });
      }
      setZoom(z);
    },
    [scrollEl, zoom],
  );
  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
      zoomTo(next ?? zoom);
    },
    [zoom, zoomTo],
  );

  useEffect(() => {
    if (!scrollEl) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(zoom * Math.exp(-e.deltaY * 0.0015));
    };
    scrollEl.addEventListener('wheel', onWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', onWheel);
  }, [scrollEl, zoom, zoomTo]);

  useSpacePan(scrollEl); // hold Space to drag-scroll (hand tool)
  useWheelResize({ selectedIds, tool, annotsRef, history, setDefaults, rememberSize }); // Alt + wheel resizes

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Only fields you type into swallow shortcuts. A focused checkbox, slider
      // or color swatch (e.g. after toggling Hand-drawn) must not block X/C/etc.
      const nonTextInputs = ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file'];
      const typing =
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        (t.tagName === 'INPUT' && !nonTextInputs.includes((t as HTMLInputElement).type)) ||
        // ...but arrows/Enter/Space still belong to a focused slider or checkbox.
        (t.tagName === 'INPUT' && /^(arrow|enter$| $)/i.test(e.key));
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'o') return e.preventDefault(), void openDialog();
      if (mod && key === 's') return e.preventDefault(), void saveProject(e.shiftKey);
      if (mod && key === 'e') return e.preventDefault(), void exportPdf();
      if (mod && (key === '=' || key === '+')) return e.preventDefault(), zoomStep(1);
      if (mod && key === '-') return e.preventDefault(), zoomStep(-1);
      if (typing) return;

      if (mod && key === 'z') return e.preventDefault(), e.shiftKey ? history.redo() : history.undo();
      if (mod && key === 'y') return e.preventDefault(), history.redo();

      const ids = new Set(selectedIds);
      const sel = annotsRef.current.filter((a) => ids.has(a.id));

      if (mod && key === 'a') {
        e.preventDefault();
        setSelectedIds(annotsRef.current.map((a) => a.id));
        return;
      }
      if (mod && key === 'd' && sel.length) {
        e.preventDefault();
        const copies = sel.map((a) => ({ ...a, id: newId(), x: a.x + 12, y: a.y + 12, ...(a.type === 'stamp' && { seed: newSeed() }) }));
        history.update((all) => [...all, ...copies]);
        setSelectedIds(copies.map((c) => c.id));
        return;
      }
      if (mod || e.altKey) return;

      if (key === 'escape') {
        if (selectedIds.length) setSelectedIds([]);
        else setTool('select');
        return;
      }
      if ((key === 'delete' || key === 'backspace') && sel.length) return e.preventDefault(), deleteSelected();
      if (key === 'enter' && sel.length === 1 && sel[0].type === 'text') return e.preventDefault(), startEdit(sel[0].id, annotsRef.current);

      if (key.startsWith('arrow') && sel.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const [dx, dy] = { arrowleft: [-d, 0], arrowright: [d, 0], arrowup: [0, -d], arrowdown: [0, d] }[key]!;
        history.update((all) => all.map((a) => (ids.has(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a)));
        return;
      }

      if (key === '[' || key === ']' || key === '{' || key === '}') {
        e.preventDefault();
        const f = key === ']' || key === '}' ? (e.shiftKey ? 1.03 : 1.1) : e.shiftKey ? 1 / 1.03 : 1 / 1.1;
        if (sel.length) {
          patchSelected((a) =>
            a.type === 'stamp' ? { w: a.w * f, h: a.h * f } : ({ size: a.size * f, lineHeight: a.lineHeight * f } as Partial<Annotation>),
          );
        } else if (tool !== 'select' && tool !== 'text') {
          setDefaults((d) => ({
            ...d,
            stamps: { ...d.stamps, [tool]: { ...d.stamps[tool], w: d.stamps[tool].w * f, h: d.stamps[tool].h * f } },
          }));
        }
        return;
      }

      if (key === 'h') {
        // Toggle hand-drawn for new stamps, and for the selected stamps
        // (all on unless they all already are).
        const stamps = sel.filter((a) => a.type === 'stamp');
        const on = stamps.length ? !stamps.every((a) => a.rough) : !defaults.hand.on;
        setDefaults((d) => ({ ...d, hand: { ...d.hand, on } }));
        if (stamps.length) patchSelected({ rough: on ? defaults.hand.amount : 0 } as Partial<Annotation>, (a) => a.type === 'stamp');
        setStatus(`Hand-drawn stamps ${on ? 'on' : 'off'}`);
        return;
      }
      if (key === 'r' && sel.some((a) => a.type === 'stamp')) {
        patchSelected(
          (a) => ({ seed: newSeed(), rough: (a as StampAnnotation).rough || defaults.hand.amount }) as Partial<Annotation>,
          (a) => a.type === 'stamp',
        );
        return;
      }

      if (KEY_TO_TOOL[key]) {
        setTool(KEY_TO_TOOL[key]);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, tool, defaults, history, exportPdf, saveProject, openDialog, zoomStep, deleteSelected, patchSelected, startEdit, setDefaults]);

  // ---- copy / cut / paste -------------------------------------------------
  // Handled as DOM clipboard events (not Ctrl+C/V keydowns): in the browser they fire from the
  // keyboard, and in Electron the Edit-menu roles fire them (the menu may eat the keydown).
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useEffect(() => {
    /** true while a text field has focus, or some text is selected: the browser's own copy/paste applies */
    const wantsText = (forPaste: boolean) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return true;
      if (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file'].includes((el as HTMLInputElement).type)) return true;
      return !forPaste && !!window.getSelection()?.toString();
    };
    const plural = (n: number) => `${n} mark${n === 1 ? '' : 's'}`;

    const onCopy = (e: ClipboardEvent) => {
      if (!pdf || !e.clipboardData || wantsText(false)) return;
      const ids = new Set(selectedIds);
      const marks = annotsRef.current.filter((a) => ids.has(a.id));
      if (!marks.length) return;
      const cut = e.type === 'cut';
      const payload = makePayload(marks, pdf.fingerprint, cut);
      e.clipboardData.setData(CLIP_MIME, JSON.stringify(payload));
      e.clipboardData.setData('text/plain', plainText(marks) || `${plural(marks.length)} from PDF Marker`);
      e.preventDefault();
      if (cut) {
        editRef.current = null;
        setEditingId(null);
        history.update((all) => all.filter((a) => !ids.has(a.id)));
        setSelectedIds([]);
      }
      setStatus(`${cut ? 'Cut' : 'Copied'} ${plural(marks.length)}`);
    };

    /** index of the page under the mouse, else the page showing the most in the scroller */
    const targetPage = () => {
      const pages = [...document.querySelectorAll<HTMLElement>('.page')];
      const p = pointer.current;
      const under = p && document.elementFromPoint(p.x, p.y)?.closest('.page');
      if (under) return pages.indexOf(under as HTMLElement);
      const view = scrollEl?.getBoundingClientRect();
      if (!view) return 0;
      let best = 0;
      let bestArea = -1;
      pages.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const area = Math.max(0, Math.min(r.right, view.right) - Math.max(r.left, view.left)) * Math.max(0, Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top));
        if (area > bestArea) [best, bestArea] = [i, area];
      });
      return best;
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!pdf || wantsText(true)) return;
      const clip = readClip(e.clipboardData);
      if (!clip) return; // nothing of ours: let the paste behave normally
      e.preventDefault();
      const page = Math.max(0, Math.min(pdf.pages.length - 1, targetPage()));
      const pasted = placeMarks(clip, pdf.fingerprint, page, pdf.pages[page], bounds, newId, newSeed);
      editRef.current = null;
      setEditingId(null);
      history.update((all) => [...all, ...pasted]);
      setSelectedIds(pasted.map((a) => a.id));
      setStatus(`Pasted ${plural(pasted.length)} on page ${page + 1}`);
    };

    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, [pdf, selectedIds, scrollEl, history]);

  // ---- drag & drop ------------------------------------------------------
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = [...(e.dataTransfer?.files ?? [])].find((f) => f.type === 'application/pdf' || /\.(pdf|pdfmark)$/i.test(f.name));
      if (f) void openFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  const byPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annots) {
      if (!m.has(a.page)) m.set(a.page, []);
      m.get(a.page)!.push(a);
    }
    return m;
  }, [annots]);

  const selection = useMemo(() => annots.filter((a) => selectedSet.has(a.id)), [annots, selectedSet]);
  const dirty = !!pdf && annots !== savedAnnots && !(savedAnnots === null && annots.length === 0);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">PDF Marker</div>
        <button onClick={openDialog} title="Open a PDF or a .pdfmark project (Ctrl+O)">Open…</button>
        <button
          onClick={(e) => saveProject(e.shiftKey)}
          disabled={!pdf}
          title={
            'Save a .pdfmark project: your marks plus the PDF in one file (Ctrl+S).\n' +
            'Shift+click or Ctrl+Shift+S to save under a new name.' +
            (projectFile ? `\nCurrently: ${projectFile.name}` : '')
          }
        >
          Save project{dirty && <span className="dirty" aria-label="unsaved changes"> •</span>}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={`application/pdf,.pdf,${PROJECT_EXT}`}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openFile(f);
            e.target.value = '';
          }}
        />
        <div className="sep" />
        <div className="tools" role="toolbar">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool ${tool === t.id ? 'on' : ''}`}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
              aria-pressed={tool === t.id}
            >
              <svg viewBox="0 0 22 22" width="20" height="20">{t.icon}</svg>
              <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        <div className="sep" />
        <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)">Redo</button>
        <div className="sep" />
        <button onClick={() => zoomStep(-1)} title="Zoom out (Ctrl -)">−</button>
        <span className="zoom">{Math.round(zoom * 100)}%</span>
        <button onClick={() => zoomStep(1)} title="Zoom in (Ctrl +)">+</button>
        <div className="spacer" />
        {pdf && (
          <span className="file" title={fileName}>
            {fileName} · {pdf.pages.length} pg · {annots.length} marks
          </span>
        )}
        {pdf && annots.length > 0 && (
          <button
            onClick={() => {
              if (confirm(`Remove all ${annots.length} marks from this document?`)) {
                history.update(() => []);
                setSelectedIds([]);
              }
            }}
          >
            Clear
          </button>
        )}
        <label
          className="toggle"
          title="Store the original PDF and your marks inside the export, so opening it here again lets you keep editing. Makes the file about twice as big."
        >
          <input
            type="checkbox"
            checked={reeditable}
            onChange={(e) => {
              setReeditable(e.target.checked);
              localStorage.setItem(REEDITABLE_KEY, e.target.checked ? '1' : '0');
            }}
          />
          Re-editable
        </label>
        <button className="primary" onClick={exportPdf} disabled={!pdf} title="Export a filled, flattened PDF (Ctrl+E)">
          Export PDF
        </button>
      </header>

      <div className="main">
        <div className="scroller" ref={setScrollEl}>
          {pdf ? (
            <div className="pages">
              {pdf.pages.map((info, i) => (
                <PageView
                  key={`${pdf.fingerprint}-${i}`}
                  index={i}
                  info={info}
                  doc={pdf.doc}
                  annots={byPage.get(i) ?? []}
                  ctl={ctl}
                  scrollRoot={scrollEl}
                />
              ))}
            </div>
          ) : (
            <div className="empty" onClick={openDialog}>
              <div className="drop-card">
                <svg viewBox="0 0 48 48" width="56" height="56">
                  <path d="M12 4h18l10 10v30H12z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
                  <circle cx="24" cy="29" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
                </svg>
                <h2>Drop a PDF here</h2>
                <p>or click to choose a file. Scans work fine. Nothing leaves your computer.</p>
              </div>
            </div>
          )}
        </div>
        <Inspector
          selection={selection}
          tool={tool}
          defaults={defaults}
          onChange={patchSelected}
          onDefaults={setDefaults}
          onDelete={deleteSelected}
          onEditText={() => selection.length === 1 && startEdit(selection[0].id, annotsRef.current)}
        />
      </div>

      {status && (
        <div className="status" onClick={() => setStatus(null)}>
          {status}
        </div>
      )}
      {dragOver && <div className="drag-overlay">Drop to open</div>}
    </div>
  );
}
