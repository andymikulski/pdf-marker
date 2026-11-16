import { useEffect, useState } from 'react';
import { FONTS, fontDef, layoutText } from './fonts';
import type { Patch } from './App';
import {
  newSeed,
  type Annotation,
  type Defaults,
  type FontFamily,
  type StampAnnotation,
  type StampKind,
  type StrikeStyle,
  type TextAnnotation,
  type Tool,
} from './types';

const SWATCHES = ['#000000', '#1a1aa6', '#0b62d6', '#c81e1e', '#11823b'];
const KIND_LABEL: Record<StampKind, string> = { circle: 'Circle', x: 'X mark', check: 'Check', dot: 'Filled dot', strike: 'Cross-out' };

/** The value shared by every item, or undefined if they differ ("mixed"). */
function common<T>(vals: T[]): T | undefined {
  if (!vals.length) return undefined;
  const same = (a: T, b: T) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);
  return vals.every((v) => same(v, vals[0])) ? vals[0] : undefined;
}

/** "2 text, 1 circle" */
function breakdown(sel: Annotation[]): string {
  const counts = new Map<string, number>();
  for (const a of sel) {
    const label = a.type === 'text' ? 'text' : KIND_LABEL[a.kind].toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => (a === 'text' ? -1 : b === 'text' ? 1 : 0))
    .map(([label, n]) => n + ' ' + label)
    .join(', ');
}
const STRIKE_STYLES: { id: StrikeStyle; label: string; path: string }[] = [
  { id: 'line', label: 'Single line', path: 'M2 9h32' },
  { id: 'double', label: 'Double line', path: 'M2 6.5h32M2 11.5h32' },
  {
    id: 'squiggle',
    label: 'Squiggle',
    path: 'M2 9' + Array.from({ length: 33 }, (_, i) => ` L${2 + i} ${(9 + 3.2 * Math.sin((i / 32) * Math.PI * 6)).toFixed(2)}`).join(''),
  },
  {
    id: 'scribble',
    label: 'Scribble',
    path: 'M2 14' + Array.from({ length: 16 }, (_, i) => ` L${4 + i * 2} ${i % 2 ? 14 : 4}`).join(''),
  },
];

interface Props {
  /** the selected marks (empty = none) */
  selection: Annotation[];
  tool: Tool;
  defaults: Defaults;
  /** commit a change to every selected mark (one undo step) */
  onChange(patch: Patch): void;
  onDefaults(fn: (d: Defaults) => Defaults): void;
  onDelete(): void;
  onEditText(): void;
}

export function Inspector({ selection, tool, defaults, onChange, onDefaults, onDelete, onEditText }: Props) {
  const selected = selection.length === 1 ? selection[0] : undefined;
  const color = selection.length ? (common(selection.map((a) => a.color)) ?? selection[0].color) : defaults.color;
  const setColor = (c: string) => {
    onDefaults((d) => ({ ...d, color: c }));
    if (selection.length) onChange({ color: c });
  };

  let body: React.ReactNode = null;

  if (selection.length > 1) {
    body = <MultiBody selection={selection} defaults={defaults} onChange={onChange} onDefaults={onDefaults} />;
  } else if (selected?.type === 'stamp') {
    const a = selected;
    body = (
      <>
        <h3>{KIND_LABEL[a.kind]}</h3>
        <Field label="Shape">
          <select value={a.kind} onChange={(e) => onChange({ kind: e.target.value as StampKind } as Partial<Annotation>)}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        {a.kind === 'strike' && (
          <StrikePicker
            value={a.strike ?? 'line'}
            onChange={(strike) => {
              onDefaults((d) => ({ ...d, strike: { style: strike } }));
              onChange({ strike } as Partial<Annotation>);
            }}
          />
        )}
        <Num label={a.kind === 'strike' ? 'Length' : 'Width'} value={a.w} min={1} onChange={(w) => onChange({ w } as Partial<Annotation>)} />
        <Num label={a.kind === 'strike' ? 'Thickness' : 'Height'} value={a.h} min={1} onChange={(h) => onChange({ h } as Partial<Annotation>)} />
        {a.kind !== 'dot' && (
          <Num label="Line width" value={a.stroke} min={0.25} step={0.25} onChange={(stroke) => onChange({ stroke } as Partial<Annotation>)} />
        )}
        <HandDrawn
          on={!!a.rough}
          amount={a.rough || defaults.hand.amount}
          onToggle={(on) => {
            onDefaults((d) => ({ ...d, hand: { ...d.hand, on } }));
            onChange({ rough: on ? defaults.hand.amount : 0 } as Partial<Annotation>);
          }}
          onAmount={(amount) => {
            onDefaults((d) => ({ ...d, hand: { ...d.hand, amount } }));
            onChange({ rough: amount } as Partial<Annotation>);
          }}
          onRedraw={() => onChange({ seed: newSeed() } as Partial<Annotation>)}
        />
        <p className="hint">
          {a.kind === 'strike'
            ? 'Drag the corner handle to change its length and thickness. '
            : 'Drag the corner handle to resize. Hold Ctrl (or Alt/Shift) while dragging to stretch it out of proportion. '}
          Changes here become the default for new {KIND_LABEL[a.kind].toLowerCase()}s.
        </p>
      </>
    );
  } else if (selected?.type === 'text') {
    const a = selected;
    const lines = layoutText(a).length;
    body = (
      <>
        <h3>Text box</h3>
        <Field label="Text">
          <textarea rows={4} value={a.text} onChange={(e) => onChange({ text: e.target.value } as Partial<Annotation>)} />
        </Field>
        <button className="link" onClick={onEditText}>Edit on page (Enter)</button>
        <FontSelect value={a.font} sample={a.text} onChange={(font) => onChange({ font } as Partial<Annotation>)} />
        <Num label="Font size" value={a.size} min={2} step={0.5} onChange={(size) => onChange({ size } as Partial<Annotation>)} />
        <Num label="Line spacing" value={a.lineHeight} min={1} step={0.25} onChange={(lineHeight) => onChange({ lineHeight } as Partial<Annotation>)} />
        <Num label="Box width" value={a.w} min={10} onChange={(w) => onChange({ w } as Partial<Annotation>)} />
        <Num label="Box height" value={a.h} min={1} onChange={(h) => onChange({ h } as Partial<Annotation>)} />
        <button onClick={() => onChange({ h: Math.max(1, lines) * a.lineHeight } as Partial<Annotation>)}>Fit height to text</button>
        <p className="hint">
          Line spacing is baseline-to-baseline in points. To fill ruled lines, set it to the gap between the
          lines and put the top of the box on the first line's top.
        </p>
      </>
    );
  } else if (tool === 'text') {
    const t = defaults.text;
    const set = (p: Partial<Defaults['text']>) => onDefaults((d) => ({ ...d, text: { ...d.text, ...p } }));
    body = (
      <>
        <h3>New text boxes</h3>
        <p className="hint">Click to drop a single-line box, or drag to draw a paragraph box.</p>
        <FontSelect value={t.font} onChange={(font) => set({ font })} />
        <Num label="Font size" value={t.size} min={2} step={0.5} onChange={(size) => set({ size })} />
        <Num label="Line spacing" value={t.lineHeight} min={1} step={0.25} onChange={(lineHeight) => set({ lineHeight })} />
        <Num label="Click width" value={t.w} min={10} onChange={(w) => set({ w })} />
      </>
    );
  } else if (tool !== 'select') {
    const s = defaults.stamps[tool];
    const set = (p: Partial<typeof s>) =>
      onDefaults((d) => ({ ...d, stamps: { ...d.stamps, [tool]: { ...d.stamps[tool], ...p } } }));
    body = (
      <>
        <h3>New {KIND_LABEL[tool].toLowerCase()}s</h3>
        <p className="hint">
          {tool === 'strike'
            ? 'Drag across the text to cross it out, or click to drop one of the default length. Alt+click starts one on top of an existing mark.'
            : 'Click to stamp. Alt+click stamps on top of an existing mark.'}
        </p>
        {tool === 'strike' && (
          <StrikePicker value={defaults.strike.style} onChange={(style) => onDefaults((d) => ({ ...d, strike: { style } }))} />
        )}
        <Num label={tool === 'strike' ? 'Click length' : 'Width'} value={s.w} min={1} onChange={(w) => set({ w })} />
        <Num label={tool === 'strike' ? 'Thickness' : 'Height'} value={s.h} min={1} onChange={(h) => set({ h })} />
        {tool !== 'dot' && <Num label="Line width" value={s.stroke} min={0.25} step={0.25} onChange={(stroke) => set({ stroke })} />}
        <HandDrawn
          on={defaults.hand.on}
          amount={defaults.hand.amount}
          onToggle={(on) => onDefaults((d) => ({ ...d, hand: { ...d.hand, on } }))}
          onAmount={(amount) => onDefaults((d) => ({ ...d, hand: { ...d.hand, amount } }))}
        />
      </>
    );
  } else {
    body = (
      <>
        <h3>Select</h3>
        <p className="hint">
          Click a mark to select it, drag to move, and drag the corner handle to resize. Drag a box over empty
          space, or Shift/Ctrl+click, to select several marks and change or move them together.
        </p>
      </>
    );
  }

  return (
    <aside className="inspector">
      {body}
      <Field label="Color">
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
      </Field>
      {selection.length > 0 && (
        <button className="danger" onClick={onDelete}>
          {selection.length > 1 ? `Delete ${selection.length} marks (Del)` : 'Delete (Del)'}
        </button>
      )}
      <Shortcuts />
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * Number field. `value` undefined = the selected marks disagree: it shows empty with a
 * "mixed" placeholder. While you type, the text you typed is kept as-is (so "1" on the way
 * to "14" isn't snapped back when it's below the minimum); it's applied as soon as it's valid.
 */
function Num({ label, value, onChange, min = 0, step = 1 }: { label: string; value: number | undefined; onChange(v: number): void; min?: number; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  // If the value changes from somewhere else (wheel, undo), stop showing the stale draft.
  useEffect(() => {
    setDraft((d) => (d !== null && value !== undefined && Math.abs(parseFloat(d) - value) < 0.005 ? d : null));
  }, [value]);
  const shown = draft ?? (value === undefined ? '' : String(Math.round(value * 100) / 100));
  return (
    <Field label={label}>
      <span className="num">
        <input
          type="number"
          value={shown}
          placeholder={value === undefined ? 'mixed' : undefined}
          min={min}
          step={step}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= min) onChange(v);
          }}
          onBlur={() => setDraft(null)}
        />
        <em>pt</em>
      </span>
    </Field>
  );
}

function StrikePicker({ value, onChange }: { value: StrikeStyle | undefined; onChange(s: StrikeStyle): void }) {
  return (
    <div className="field">
      <span>Style</span>
      <div className="strike-styles" role="radiogroup" aria-label="Cross-out style">
        {STRIKE_STYLES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={s.id === value}
            className={`strike-style ${s.id === value ? 'on' : ''}`}
            title={s.label}
            onClick={() => onChange(s.id)}
          >
            <svg viewBox="0 0 36 18" width="36" height="18">
              <path d={s.path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function HandDrawn(props: {
  on: boolean;
  /** some of the selected stamps are hand-drawn and some aren't */
  mixed?: boolean;
  amount: number;
  onToggle(on: boolean): void;
  onAmount(v: number): void;
  onRedraw?(): void;
}) {
  return (
    <div className="hand">
      <label className="check">
        <input
          type="checkbox"
          checked={props.on}
          ref={(el) => {
            if (el) el.indeterminate = !!props.mixed;
          }}
          onChange={(e) => props.onToggle(e.target.checked)}
        />
        Hand-drawn <kbd>H</kbd>
      </label>
      {(props.on || props.mixed) && (
        <>
          <label className="field">
            <span>Wobble</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={props.amount}
              onChange={(e) => props.onAmount(parseFloat(e.target.value))}
            />
          </label>
          {props.onRedraw && (
            <button onClick={props.onRedraw} title="Draw this mark again with a new random wobble">
              Redraw <kbd>R</kbd>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Font dropdown that previews every font, using the user's own text when there is some. */
function FontSelect({ value, onChange, sample, mixed }: { value: FontFamily; onChange(f: FontFamily): void; sample?: string; mixed?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = fontDef(value);
  const preview = sample?.trim().split('\n')[0].slice(0, 60) || 'Jane Q. Example · March 4, 2026';
  return (
    <div className="field font-select" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <span>Font</span>
      <button
        className="font-current"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ fontFamily: current.css }}
      >
        {mixed ? 'Mixed' : current.label}
        <em aria-hidden>▾</em>
      </button>
      {open && (
        <div className="font-list" role="listbox" aria-label="Font">
          {(['Handwriting', 'Standard'] as const).map((group) => (
            <div key={group}>
              <div className="font-group">{group}</div>
              {FONTS.filter((f) => f.group === group).map((f) => (
                <button
                  key={f.id}
                  role="option"
                  aria-selected={!mixed && f.id === value}
                  className={`font-opt ${!mixed && f.id === value ? 'on' : ''}`}
                  onClick={() => {
                    onChange(f.id);
                    setOpen(false);
                  }}
                >
                  <span className="font-name">{f.label}</span>
                  <span className="font-sample" style={{ fontFamily: f.css }}>
                    {preview}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The side panel for 2+ selected marks: only properties that make sense for the whole set. */
function MultiBody({
  selection,
  defaults,
  onChange,
  onDefaults,
}: {
  selection: Annotation[];
  defaults: Defaults;
  onChange(patch: Patch): void;
  onDefaults(fn: (d: Defaults) => Defaults): void;
}) {
  const texts = selection.filter((a): a is TextAnnotation => a.type === 'text');
  const stamps = selection.filter((a): a is StampAnnotation => a.type === 'stamp');
  const allText = texts.length === selection.length;
  const allStamps = stamps.length === selection.length;
  const kind = allStamps ? common(stamps.map((a) => a.kind)) : undefined; // set when all the same kind
  const patch = (p: Record<string, unknown>) => onChange(p as Partial<Annotation>);
  const roughCount = stamps.filter((a) => a.rough).length;
  const roughAmount = common(stamps.filter((a) => a.rough).map((a) => a.rough!)) ?? stamps.find((a) => a.rough)?.rough;

  return (
    <>
      <h3>{selection.length} marks selected</h3>
      <p className="hint sel-summary">{breakdown(selection)}</p>

      {allText && (
        <>
          <FontSelect
            value={common(texts.map((a) => a.font)) ?? texts[0].font}
            mixed={common(texts.map((a) => a.font)) === undefined}
            sample={texts[0].text}
            onChange={(font) => patch({ font })}
          />
          <Num label="Font size" value={common(texts.map((a) => a.size))} min={2} step={0.5} onChange={(size) => patch({ size })} />
          <Num label="Line spacing" value={common(texts.map((a) => a.lineHeight))} min={1} step={0.25} onChange={(lineHeight) => patch({ lineHeight })} />
          <Num label="Box width" value={common(texts.map((a) => a.w))} min={10} onChange={(w) => patch({ w })} />
        </>
      )}

      {allStamps && (
        <>
          {kind === 'strike' && (
            <StrikePicker
              value={common(stamps.map((a) => a.strike ?? 'line'))}
              onChange={(strike) => {
                onDefaults((d) => ({ ...d, strike: { style: strike } }));
                patch({ strike });
              }}
            />
          )}
          {kind && (
            <>
              <Num label={kind === 'strike' ? 'Length' : 'Width'} value={common(stamps.map((a) => a.w))} min={1} onChange={(w) => patch({ w })} />
              <Num label={kind === 'strike' ? 'Thickness' : 'Height'} value={common(stamps.map((a) => a.h))} min={1} onChange={(h) => patch({ h })} />
            </>
          )}
          {stamps.some((a) => a.kind !== 'dot') && (
            <Num label="Line width" value={common(stamps.map((a) => a.stroke))} min={0.25} step={0.25} onChange={(stroke) => patch({ stroke })} />
          )}
          <HandDrawn
            on={roughCount === stamps.length}
            mixed={roughCount > 0 && roughCount < stamps.length}
            amount={roughAmount ?? defaults.hand.amount}
            onToggle={(on) => {
              onDefaults((d) => ({ ...d, hand: { ...d.hand, on } }));
              patch({ rough: on ? defaults.hand.amount : 0 });
            }}
            onAmount={(amount) => {
              onDefaults((d) => ({ ...d, hand: { ...d.hand, amount } }));
              // only the hand-drawn ones wobble; leave clean ones clean
              onChange((a) => (a.type === 'stamp' && a.rough ? { rough: amount } : {}) as Partial<Annotation>);
            }}
            onRedraw={() => onChange(() => ({ seed: newSeed() }) as Partial<Annotation>)}
          />
        </>
      )}
      {!allText && !allStamps && <p className="hint">Text boxes and stamps are mixed, so only the colour is shared.</p>}
      <p className="hint">
        Changes here apply to every selected mark. Drag any selected mark to move them all. Shift/Ctrl+click
        adds or removes a mark.
      </p>
    </>
  );
}

function Shortcuts() {
  return (
    <details className="shortcuts">
      <summary>Keyboard shortcuts</summary>
      <dl>
        <dt>V / C / X / K / D / S / T</dt><dd>Select, Circle, X, Check, Dot, Cross-out, Text</dd>
        <dt>Esc</dt><dd>Stop editing, then deselect, then Select tool</dd>
        <dt>Shift / Ctrl + click</dt><dd>Add or remove a mark from the selection (any tool)</dd>
        <dt>V, then drag a box</dt><dd>Select every mark the box touches (Shift/Ctrl = add)</dd>
        <dt>Ctrl+A</dt><dd>Select all marks, on every page</dd>
        <dt>Del</dt><dd>Delete selected</dd>
        <dt>Arrows</dt><dd>Nudge all selected (Shift = 10pt)</dd>
        <dt>[ and ]</dt><dd>Shrink / grow all selected (Shift = fine)</dd>
        <dt>Alt + wheel</dt><dd>Resize the selected marks, or the next stamp</dd>
        <dt>Enter</dt><dd>Edit the selected text box</dd>
        <dt>Ctrl+Enter</dt><dd>Finish editing text</dd>
        <dt>H</dt><dd>Hand-drawn stamps on/off</dd>
        <dt>R</dt><dd>Redraw selected hand-drawn stamps</dd>
        <dt>Ctrl+D</dt><dd>Duplicate selected</dd>
        <dt>Ctrl+C / Ctrl+X</dt><dd>Copy / cut the selected marks</dd>
        <dt>Ctrl+V</dt><dd>Paste at the same spot on the page under your mouse (works across pages and open files)</dd>
        <dt>Ctrl+Z / Ctrl+Y</dt><dd>Undo / redo</dd>
        <dt>Ctrl + wheel, Ctrl +/-</dt><dd>Zoom</dd>
        <dt>Space (hold) + drag</dt><dd>Pan around the document</dd>
        <dt>Ctrl+O</dt><dd>Open a PDF or .pdfmark project</dd>
        <dt>Ctrl+S</dt><dd>Save project (Shift = save as)</dd>
        <dt>Ctrl+E</dt><dd>Export filled PDF</dd>
        <dt>Ctrl/Alt/Shift + drag handle</dt><dd>Stretch freely (e.g. an oval around a word)</dd>
      </dl>
    </details>
  );
}
