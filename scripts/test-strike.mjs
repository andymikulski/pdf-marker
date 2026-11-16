// Checks for the cross-out ("strike") stamp: geometry of every style, seeded
// determinism, and vector export on rotated pages. Run with: node scripts/test-strike.mjs
import { createServer } from 'vite';
import { PDFDocument, degrees } from 'pdf-lib';
import './node-polyfills.mjs';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const FONT_URL = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(sep).join('/');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { stampShape, resizeStamp } = await vite.ssrLoadModule('/src/geometry.ts');
const { initFonts } = await vite.ssrLoadModule('/src/fonts.ts');
const { exportVector } = await vite.ssrLoadModule('/src/exporter.ts');
const { DEFAULTS } = await vite.ssrLoadModule('/src/types.ts');
await initFonts();

let failures = 0;
const fail = (...m) => (failures++, console.error(...m));

const STYLES = ['line', 'double', 'squiggle', 'scribble'];
const mk = (strike, extra = {}) => ({
  id: `s-${strike}`, type: 'stamp', kind: 'strike', page: 0, color: '#c81e1e',
  x: 200, y: 150, w: 80, h: 8, stroke: 1.25, strike, ...extra,
});

if (!DEFAULTS.stamps.strike || DEFAULTS.strike.style !== 'line') fail('missing strike defaults');

// 1. Geometry: polylines, finite, inside the box (clean) / near it (rough).
for (const style of STYLES) {
  for (const rough of [0, 0.6, 1]) {
    const a = mk(style, { rough, seed: 42 });
    const s = stampShape(a);
    if (s.kind !== 'polylines') { fail(style, 'not polylines'); continue; }
    const expectLines = style === 'double' ? 2 : 1;
    if (s.lines.length !== expectLines) fail(style, rough, 'line count', s.lines.length);
    // Rough strokes may over/undershoot the ends by up to 6% of the length and drift a bit vertically.
    const xTol = rough ? 0.08 * a.w + 0.5 : 1e-6, yTol = rough ? 0.5 * a.h + 1.5 : 1e-6;
    for (const line of s.lines) {
      if (line.length < 2) fail(style, 'too few points');
      for (const [x, y] of line) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) fail(style, rough, 'non-finite point');
        if (Math.abs(x - a.x) > a.w / 2 + xTol) fail(style, rough, 'x outside box', x);
        if (Math.abs(y - a.y) > a.h / 2 + yTol) fail(style, rough, 'y outside box', y);
      }
      // spans (nearly) the whole width
      const xs = line.map((p) => p[0]);
      const span = Math.max(...xs) - Math.min(...xs);
      if (span < a.w * 0.8) fail(style, rough, 'span too short', span);
      if (!rough) {
        if (Math.abs(xs[0] - (a.x - a.w / 2 + a.stroke / 2)) > 1e-6) fail(style, 'clean start x');
        if (Math.abs(xs[xs.length - 1] - (a.x + a.w / 2 - a.stroke / 2)) > 1e-6) fail(style, 'clean end x');
      }
    }
    if (!rough && style === 'line' && !s.lines[0].every((p) => p[1] === a.y)) fail('clean line is not horizontal');
    if (!rough && style === 'double') {
      const [u, l] = s.lines.map((ln) => ln[0][1]);
      if (Math.abs(Math.abs(u - l) - a.h / 2) > 1e-6) fail('double spacing', u, l);
    }
    if (!rough && style === 'squiggle') {
      const line = s.lines[0];
      if (line.length < 30) fail('squiggle sampled too sparsely', line.length);
      const ys = line.map((p) => p[1]);
      const amp = Math.max(...ys.map((y) => Math.abs(y - a.y)));
      if (amp < (a.h / 2 - a.stroke / 2) * 0.9) fail('squiggle amplitude too small', amp);
      // ends on the centre line
      if (Math.abs(ys[0] - a.y) > 1e-6 || Math.abs(ys[ys.length - 1] - a.y) > 1e-6) fail('squiggle ends off-centre');
    }
  }
}
// Undefined style falls back to a single line.
if (stampShape({ ...mk('line'), strike: undefined }).lines.length !== 1) fail('default style is not line');

// 2. Hand-drawn output is deterministic per seed and differs between seeds.
for (const style of STYLES) {
  const a = mk(style, { rough: 0.7, seed: 1234 });
  const same = JSON.stringify(stampShape(a)) === JSON.stringify(stampShape({ ...a }));
  const differs = JSON.stringify(stampShape(a)) !== JSON.stringify(stampShape({ ...a, seed: 99 }));
  const roughDiffers = JSON.stringify(stampShape(a)) !== JSON.stringify(stampShape({ ...a, rough: 0 }));
  if (!same || !differs || !roughDiffers) fail(style, 'determinism', { same, differs, roughDiffers });
}

// 3. Strikes resize freely (the app passes free=true): length and thickness are independent.
const r = resizeStamp(mk('line'), [200 + 60, 150 + 2], true);
if (Math.abs(r.w - 120) > 1e-9 || Math.abs(r.h - 4) > 1e-9) fail('free resize', r);

// 4. Export every style (clean + hand-drawn) on rotated pages with an offset media box.
const src = await PDFDocument.create();
for (const rot of [0, 90, 180, 270]) {
  const p = src.addPage([612, 792]);
  p.setMediaBox(50, 100, 612, 792);
  p.setRotation(degrees(rot));
  p.drawText(`rotation ${rot}  The quick brown fox jumps over the lazy dog`, { x: 120, y: 700, size: 16 });
}
const srcBytes = await src.save();
const doc = await pdfjs.getDocument({ data: srcBytes.slice(), standardFontDataUrl: FONT_URL }).promise;
const infos = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale: 1 });
  infos.push({ width: vp.width, height: vp.height, rotation: page.rotate, view: [...page.view] });
}
const annots = infos.flatMap((_, page) =>
  STYLES.flatMap((style, i) => [
    { ...mk(style), id: `c-${style}-${page}`, page, y: 80 + i * 30, x: 120 },
    { ...mk(style, { rough: 0.7, seed: 7 + i }), id: `r-${style}-${page}`, page, y: 80 + i * 30, x: 280, w: 100, h: 10, stroke: 1.5 },
  ]),
);
const out = await exportVector(srcBytes, infos, annots);
mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/strike-src.pdf', srcBytes);
writeFileSync('test-output/strike-filled.pdf', out);
const re = await pdfjs.getDocument({ data: out.slice(), standardFontDataUrl: FONT_URL }).promise;
if (re.numPages !== 4) fail('page count changed');
// The marks are vector paths: each page's content stream should have grown.
if (out.length <= srcBytes.length) fail('export did not add content');
for (let p = 1; p <= 4; p++) {
  const ops = await (await re.getPage(p)).getOperatorList();
  const strokes = ops.fnArray.filter((f) => f === pdfjs.OPS.stroke || f === pdfjs.OPS.constructPath).length;
  if (strokes < annots.filter((a) => a.page === p - 1).length) fail(`page ${p}: too few path operations`, strokes);
}

await vite.close();
console.log(failures ? `${failures} FAILURE(S)` : 'All strike checks passed. Exports are in test-output/strike-*.pdf');
process.exit(failures ? 1 : 0);
