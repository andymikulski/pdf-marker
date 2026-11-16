// Unit test for the stamp resize math, run with: npm test
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { resizeStamp } = await vite.ssrLoadModule('/src/geometry.ts');

const stamp = (w, h) => ({ id: 's', type: 'stamp', kind: 'circle', page: 0, x: 100, y: 200, w, h, stroke: 2, color: '#000' });

let failures = 0;
const near = (a, b) => Math.abs(a - b) < 1e-9;
function check(name, cond, detail) {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  } else console.log(`ok   ${name}`);
}
const fmt = (r) => `{w:${r.w}, h:${r.h}}`;

// Proportional: square stamp keeps 1:1 and follows the larger axis.
{
  const r = resizeStamp(stamp(40, 40), [100 + 50, 200 + 20], false);
  check('proportional square keeps 1:1', near(r.w, r.h), fmt(r));
  check('proportional square follows larger axis', near(r.w, 100), fmt(r));
}

// Proportional: an already non-square stamp keeps its aspect ratio.
{
  const o = stamp(80, 20);
  for (const pt of [[160, 215], [110, 260], [100 + 300, 200 + 5], [100 + 3, 200 + 3]]) {
    const r = resizeStamp(o, pt, false);
    check(`proportional non-square keeps 4:1 for drag to ${pt}`, near(r.w / r.h, 4), fmt(r));
  }
  const r = resizeStamp(o, [100 + 80, 200 + 5], false); // w -> 160 = 2x
  check('proportional non-square scale factor', near(r.w, 160) && near(r.h, 40), fmt(r));
}

// Free: independent w and h (wide oval).
{
  const r = resizeStamp(stamp(40, 40), [100 + 90, 200 + 10], true);
  check('free gives independent w/h', near(r.w, 180) && near(r.h, 20), fmt(r));
  const r2 = resizeStamp(stamp(80, 20), [100 + 5, 200 + 50], true);
  check('free tall from wide stamp', near(r2.w, 10) && near(r2.h, 100), fmt(r2));
}

// Minimum size clamp.
{
  const r = resizeStamp(stamp(40, 40), [100, 200], true);
  check('free clamps both to 2 at centre', near(r.w, 2) && near(r.h, 2), fmt(r));
  const r2 = resizeStamp(stamp(40, 40), [100 + 0.1, 200 + 30], true);
  check('free clamps only the small axis', near(r2.w, 2) && near(r2.h, 60), fmt(r2));
  const r3 = resizeStamp(stamp(40, 40), [100, 200], false);
  check('proportional at centre is 2x2 for square', near(r3.w, 2) && near(r3.h, 2), fmt(r3));
  const r4 = resizeStamp(stamp(80, 20), [100, 200], false);
  check('proportional at centre keeps aspect and both >= 2', near(r4.w / r4.h, 4) && r4.h >= 2 && r4.w >= 2, fmt(r4));
}

// Dragging past the centre to the opposite side still gives a positive size.
{
  for (const free of [false, true]) {
    const r = resizeStamp(stamp(40, 20), [100 - 30, 200 - 50], free);
    check(`opposite side positive (free=${free})`, r.w > 0 && r.h > 0, fmt(r));
    const mirror = resizeStamp(stamp(40, 20), [100 + 30, 200 + 50], free);
    check(`opposite side mirrors same-side result (free=${free})`, near(r.w, mirror.w) && near(r.h, mirror.h), `${fmt(r)} vs ${fmt(mirror)}`);
  }
}

await vite.close();
if (failures) {
  console.error(`${failures} resize test(s) FAILED`);
  process.exit(1);
}
console.log('resize tests passed');
