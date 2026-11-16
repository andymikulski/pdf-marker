// Unit test for copy/paste placement and clipboard parsing, run with: npm test
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { makePayload, parsePayload, placeMarks, readClip, plainText } = await vite.ssrLoadModule('/src/clipboard.ts');

let failures = 0;
function check(name, cond, detail) {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  } else console.log(`ok   ${name}`);
}
const stamp = (id, page, x, y) => ({ id, type: 'stamp', kind: 'circle', page, x, y, w: 16, h: 16, stroke: 2, color: '#000', seed: 1 });
const text = (id, page, x, y, t) => ({ id, type: 'text', page, x, y, w: 100, h: 20, text: t, font: 'Helvetica', size: 11, lineHeight: 14, color: '#000' });
const boundsOf = (a) => (a.type === 'stamp' ? { x: a.x - a.w / 2, y: a.y - a.h / 2, w: a.w, h: a.h } : { x: a.x, y: a.y, w: a.w, h: a.h });
const page = { width: 612, height: 792 };
let n = 0;
const place = (clip, doc, pg, size = page) => placeMarks(clip, doc, pg, size, boundsOf, () => `id${++n}`, () => 42);

// Different page: same coordinates, new ids and seeds, new page.
{
  const clip = makePayload([stamp('a', 1, 500, 100)], 'docA', false);
  const [p] = place(clip, 'docA', 0);
  check('other page keeps coordinates', p.x === 500 && p.y === 100 && p.page === 0, JSON.stringify(p));
  check('new id and seed', p.id !== 'a' && p.seed === 42);
  const [q] = place(clip, 'docA', 0);
  check('second paste on that page cascades +12', q.x === 512 && q.y === 112, JSON.stringify(q));
  const [r] = place(clip, 'docA', 0);
  check('third paste +24', r.x === 524 && r.y === 124);
}
// Same page, same doc: +12, then +24.
{
  const clip = makePayload([stamp('a', 1, 100, 100)], 'docA', false);
  check('same page offsets +12', place(clip, 'docA', 1)[0].x === 112);
  check('same page cascades +24', place(clip, 'docA', 1)[0].x === 124);
}
// Same page index but a different document is not "the same page".
{
  const clip = makePayload([stamp('a', 0, 100, 100)], 'docA', false);
  check('other document, same page index: in place', place(clip, 'docB', 0)[0].x === 100);
}
// Cut then paste restores in place.
{
  const clip = makePayload([stamp('a', 0, 100, 100)], 'docA', true);
  check('paste after cut restores in place', place(clip, 'docA', 0)[0].x === 100);
  check('then cascades', place(clip, 'docA', 0)[0].x === 112);
}
// Clamping.
{
  const clip = makePayload([stamp('a', 1, 608, 788)], 'docA', false);
  const [p] = place(clip, 'docA', 1);
  check('clamped inside page', p.x + 8 <= 612 && p.y + 8 <= 792 && p.x + 8 > 611.99, JSON.stringify(p));
  const small = place(makePayload([stamp('a', 1, 500, 100)], 'docA', false), 'docA', 0, { width: 200, height: 200 })[0];
  check('clamped into a smaller page', small.x + 8 <= 200 && small.y === 100, JSON.stringify(small));
}
// Groups keep their layout; several source pages put everything on the target page as-is.
{
  const clip = makePayload([stamp('a', 0, 580, 100), text('b', 2, 300, 100, 'hi')], 'docA', false);
  check('multi-page source has no source page', clip.page === -1);
  const [a, b] = place(clip, 'docA', 1);
  check('relative layout kept', b.x - a.x === 300 - 580 && b.y - a.y === 0, `${a.x},${b.x}`);
  check('group clamped as a whole', a.x + 8 <= 612 && a.x === 580, `${a.x}`);
}
// Parsing / validation.
{
  const clip = makePayload([text('b', 0, 1, 2, 'Jane')], 'docA', false);
  check('round trip', parsePayload(JSON.stringify(clip))?.marks[0].text === 'Jane');
  check('garbage rejected', parsePayload('hello') === null && parsePayload('{"app":"x"}') === null && parsePayload('') === null);
  check('bad mark rejected', parsePayload(JSON.stringify({ ...clip, marks: [{ type: 'stamp' }] })) === null);
  const dt = { getData: (t) => (t === 'application/x-pdfmark+json' ? 'not json' : '') };
  check('falls back to memory copy', readClip(dt)?.clipId === clip.clipId);
  check('plain text twin', plainText([text('b', 0, 1, 2, 'Jane'), stamp('s', 0, 1, 1), text('c', 0, 1, 2, 'Doe')]) === 'Jane\nDoe');
}

await vite.close();
if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
