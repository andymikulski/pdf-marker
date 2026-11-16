// Sanity test for the coordinate mapping + exporter, run with: npm test
// Uses pdf.js's own viewport transform as the oracle for rotated / offset pages.
import { createServer } from 'vite';
import { PDFDocument, degrees } from 'pdf-lib';
import './node-polyfills.mjs';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const FONT_URL = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(sep).join('/');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { toPdfPoint } = await vite.ssrLoadModule('/src/geometry.ts');
const { initFonts } = await vite.ssrLoadModule('/src/fonts.ts');
const { exportVector } = await vite.ssrLoadModule('/src/exporter.ts');
await initFonts();

// Build a test PDF: 4 rotations, with a non-zero-origin media box.
const src = await PDFDocument.create();
for (const rot of [0, 90, 180, 270]) {
  const p = src.addPage([612, 792]);
  p.setMediaBox(50, 100, 612, 792);
  p.setRotation(degrees(rot));
  p.drawText(`rotation ${rot}`, { x: 120, y: 700, size: 20 });
}
const srcBytes = await src.save();

const doc = await pdfjs.getDocument({ data: srcBytes.slice(), standardFontDataUrl: FONT_URL }).promise;
let failures = 0;
const infos = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale: 1 });
  const [a, b, c, d] = page.view;
  const info = { width: vp.width, height: vp.height, rotation: page.rotate, view: [a, b, c, d] };
  infos.push(info);
  for (const [dx, dy] of [[0, 0], [10, 20], [vp.width, vp.height], [123.4, 456.7]]) {
    const mine = toPdfPoint(info, dx, dy);
    const oracle = vp.convertToPdfPoint(dx, dy);
    const err = Math.hypot(mine[0] - oracle[0], mine[1] - oracle[1]);
    if (err > 1e-6) {
      failures++;
      console.error(`rot ${page.rotate} (${dx},${dy}): got ${mine}, expected ${oracle}`);
    }
  }
}

// Export a sample of every annotation type on every page.
const annots = infos.flatMap((info, page) => [
  { id: `c${page}`, type: 'stamp', kind: 'circle', page, color: '#1a1aa6', x: 60, y: 60, w: 16, h: 16, stroke: 1.5 },
  { id: `x${page}`, type: 'stamp', kind: 'x', page, color: '#c81e1e', x: 90, y: 60, w: 10, h: 10, stroke: 1.5 },
  { id: `k${page}`, type: 'stamp', kind: 'check', page, color: '#11823b', x: 120, y: 60, w: 12, h: 12, stroke: 1.75 },
  { id: `d${page}`, type: 'stamp', kind: 'dot', page, color: '#000000', x: 150, y: 60, w: 8, h: 8, stroke: 0 },
  // handwriting fonts (embedded via fontkit)
  ...['Caveat', 'DancingScript', 'HomemadeApple'].map((font, i) => ({
    id: `f${font}${page}`, type: 'text', page, color: '#1a1aa6', x: 40, y: 260 + i * 30, w: 300, h: 24, font,
    size: 16, lineHeight: 24, text: `${font} on page ${page + 1} — Jane Q. Exämple`,
  })),
  // hand-drawn variants
  ...['circle', 'x', 'check', 'dot'].map((kind, i) => ({
    id: `h${kind}${page}`, type: 'stamp', kind, page, color: '#1a1aa6', x: 60 + i * 30, y: 200, w: 16, h: 16,
    stroke: 1.5, rough: 0.8, seed: 1234 + i,
  })),
  {
    id: `t${page}`, type: 'text', page, color: '#000000', x: 40, y: 90, w: 220, h: 60, font: 'Helvetica', size: 11, lineHeight: 15,
    text: `Top-left reads upright on page ${page + 1}. This paragraph should wrap inside the box — “quotes” & ünïcödé ✓ ok.\nNew line.`,
  },
]);
const out = await exportVector(srcBytes, infos, annots);
mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/rotations-src.pdf', srcBytes);
writeFileSync('test-output/rotations-filled.pdf', out);

// The output must re-open in pdf.js with the same page count and contain our text.
const re = await pdfjs.getDocument({ data: out.slice(), standardFontDataUrl: FONT_URL }).promise;
if (re.numPages !== 4) failures++, console.error('page count changed');
const txt = (await (await re.getPage(2)).getTextContent()).items.map((i) => i.str).join(' ');
if (!txt.includes('Top-left reads upright on page 2')) failures++, console.error('text missing:', txt);
for (const f of ['Caveat', 'DancingScript', 'HomemadeApple']) {
  if (!txt.includes(`${f} on page 2`)) failures++, console.error(`${f} text missing from export:`, txt);
}

// Project round-trip: an export with an embedded project gives back the
// untouched original bytes and the same marks.
const { extractProject } = await vite.ssrLoadModule('/src/project.ts');
const project = { original: srcBytes, data: { version: 1, name: 'rotations.pdf', annots } };
const withProject = await exportVector(srcBytes, infos, annots, project);
writeFileSync('test-output/rotations-filled-project.pdf', withProject);
const back = await extractProject(withProject);
if (!back) failures++, console.error('project not found in export');
else {
  if (Buffer.compare(Buffer.from(back.original), Buffer.from(srcBytes)) !== 0) failures++, console.error('original bytes differ');
  if (JSON.stringify(back.data.annots) !== JSON.stringify(annots)) failures++, console.error('annotations differ');
}
if ((await extractProject(srcBytes)) !== null) failures++, console.error('false positive on a plain PDF');
if ((await extractProject(out)) !== null) failures++, console.error('false positive on a non-project export');
const pj = await pdfjs.getDocument({ data: withProject.slice(), standardFontDataUrl: FONT_URL }).promise;
if (pj.numPages !== 4) failures++, console.error('project export does not open in pdf.js');
console.log(`export sizes: plain ${out.length} B, with project ${withProject.length} B (original ${srcBytes.length} B)`);

// Hand-drawn shapes are deterministic for a given seed and differ between seeds.
const { stampShape } = await vite.ssrLoadModule('/src/geometry.ts');
const hc = annots.find((a) => a.id === 'hcircle0');
const same = JSON.stringify(stampShape(hc)) === JSON.stringify(stampShape({ ...hc }));
const differs = JSON.stringify(stampShape(hc)) !== JSON.stringify(stampShape({ ...hc, seed: 99 }));
if (!same || !differs) failures++, console.error('hand-drawn determinism', { same, differs });

// Every font sits its first line on the bottom of the first line band (within
// a fifth of the font size), so switching fonts never makes text float up.
const { FONTS, layoutText } = await vite.ssrLoadModule('/src/fonts.ts');
for (const f of FONTS) {
  const a = { type: 'text', font: f.id, size: 13, lineHeight: 18, x: 0, y: 100, w: 400, h: 18, text: 'Jane pgy' };
  const lift = 118 - layoutText(a)[0].baseline;
  if (lift < 1 || lift > 0.25 * 13) failures++, console.error(`${f.label}: baseline ${lift.toFixed(2)}pt above line bottom`);
}

// .pdfmark project files round-trip.
const { serializeProjectFile, parseProjectFile } = await vite.ssrLoadModule('/src/project.ts');
const pm = new Uint8Array(await serializeProjectFile(project).arrayBuffer());
writeFileSync('test-output/rotations.pdfmark', pm);
const pmBack = parseProjectFile(pm);
if (Buffer.compare(Buffer.from(pmBack.original), Buffer.from(srcBytes)) !== 0) failures++, console.error('.pdfmark original differs');
if (JSON.stringify(pmBack.data.annots) !== JSON.stringify(annots)) failures++, console.error('.pdfmark annots differ');

await vite.close();
console.log(failures ? `${failures} FAILURE(S)` : 'All export checks passed. See test-output/ for a visual check.');
process.exit(failures ? 1 : 0);
