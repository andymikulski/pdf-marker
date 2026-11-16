import type { PageInfo, StampAnnotation } from './types';

export type Pt = [number, number];

/**
 * Convert a point from displayed-page space (points, top-left origin, after
 * /Rotate is applied) into PDF user space for that page.
 */
export function toPdfPoint(page: PageInfo, dx: number, dy: number): Pt {
  const [x0, y0, x1, y1] = page.view;
  switch (page.rotation) {
    case 90:
      return [x0 + dy, y0 + dx];
    case 180:
      return [x1 - dx, y0 + dy];
    case 270:
      return [x1 - dy, y1 - dx];
    default:
      return [x0 + dx, y1 - dy];
  }
}

export type StampShape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; filled: boolean }
  | { kind: 'polylines'; lines: Pt[][] }
  /** closed polygon, filled (hand-drawn dot) */
  | { kind: 'blob'; points: Pt[] };

/** Geometry for a stamp in displayed-page space; shared by the screen renderer and exporter. */
export function stampShape(a: StampAnnotation): StampShape {
  if (a.kind === 'strike') return strikeShape(a);
  const s = a.kind === 'dot' ? 0 : a.stroke;
  const hw = Math.max(a.w / 2 - s / 2, 0.25);
  const hh = Math.max(a.h / 2 - s / 2, 0.25);
  if (a.rough && a.rough > 0) return handDrawn(a, hw, hh);
  switch (a.kind) {
    case 'circle':
      return { kind: 'ellipse', cx: a.x, cy: a.y, rx: hw, ry: hh, filled: false };
    case 'dot':
      return { kind: 'ellipse', cx: a.x, cy: a.y, rx: a.w / 2, ry: a.h / 2, filled: true };
    case 'x':
      return {
        kind: 'polylines',
        lines: [
          [[a.x - hw, a.y - hh], [a.x + hw, a.y + hh]],
          [[a.x + hw, a.y - hh], [a.x - hw, a.y + hh]],
        ],
      };
    case 'check': {
      const f = (fx: number, fy: number): Pt => [a.x - hw + fx * 2 * hw, a.y - hh + fy * 2 * hh];
      return { kind: 'polylines', lines: [[f(0, 0.55), f(0.36, 0.95), f(1, 0.05)]] };
    }
  }
}

/* ---------------------------------------------------------------------------
 * Hand-drawn variants. All randomness comes from a PRNG seeded per stamp, and
 * is applied in the shape's normalized [-1, 1] box, so a given stamp looks the
 * same every time (screen, export, reload) and keeps its character when resized.
 * ------------------------------------------------------------------------- */

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function handDrawn(a: StampAnnotation, hw: number, hh: number): StampShape {
  const k = clamp(a.rough ?? 0, 0, 1);
  const rnd = mulberry32(a.seed ?? 1);
  const sym = () => rnd() * 2 - 1; // [-1, 1]
  // Map normalized coords to the page, with a small whole-shape tilt.
  const tilt = sym() * 0.16 * k;
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  const toPage = ([u, v]: Pt): Pt => [a.x + (u * cos - v * sin) * hw, a.y + (u * sin + v * cos) * hh];

  // Quadratic curve from p to q bowed sideways by `bow` (fraction of its length).
  const stroke = (p: Pt, q: Pt, bow: number, n = 14): Pt[] => {
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const c: Pt = [mx - dy * bow, my + dx * bow];
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = 1 - t;
      pts.push([s * s * p[0] + 2 * s * t * c[0] + t * t * q[0], s * s * p[1] + 2 * s * t * c[1] + t * t * q[1]]);
    }
    return pts;
  };
  const jit = (p: Pt, amt: number): Pt => [p[0] + sym() * amt * k, p[1] + sym() * amt * k];

  switch (a.kind) {
    case 'circle': {
      // One pen loop that overshoots its start, with an uneven radius and the
      // end not quite meeting the start.
      const start = rnd() * Math.PI * 2;
      const sweep = Math.PI * 2 * (1 + (0.06 + 0.14 * rnd()) * Math.max(k, 0.3));
      const drift = (0.08 + 0.1 * rnd()) * k * (rnd() < 0.5 ? -1 : 1);
      const a2 = sym() * 0.07 * k, p2 = rnd() * 6.3;
      const a3 = sym() * 0.05 * k, p3 = rnd() * 6.3;
      const squash = 1 + sym() * 0.1 * k;
      const dir = rnd() < 0.75 ? -1 : 1; // most people draw circles counter-clockwise
      const n = 72;
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const th = start + dir * sweep * t;
        const r = 0.94 + drift * (t - 0.5) + a2 * Math.sin(2 * th + p2) + a3 * Math.sin(3 * th + p3);
        pts.push(toPage([Math.cos(th) * r * squash, Math.sin(th) * r / squash]));
      }
      return { kind: 'polylines', lines: [pts] };
    }
    case 'x': {
      const l1 = stroke(jit([-0.92, -0.92], 0.14), jit([0.92, 0.92], 0.14), sym() * 0.08 * k);
      const l2 = stroke(jit([0.92, -0.92], 0.14), jit([-0.92, 0.92], 0.14), sym() * 0.08 * k);
      return { kind: 'polylines', lines: [l1.map(toPage), l2.map(toPage)] };
    }
    case 'check': {
      const p0 = jit([-0.95, 0.08], 0.12);
      const p1 = jit([-0.3, 0.88], 0.1);
      const p2 = jit([0.95, -0.92], 0.1);
      const short = stroke(p0, p1, sym() * 0.06 * k, 8);
      const long = stroke(p1, p2, (0.04 + rnd() * 0.08) * k, 16);
      return { kind: 'polylines', lines: [[...short, ...long.slice(1)].map(toPage)] };
    }
    case 'dot': {
      const a2 = sym() * 0.07 * k, p2 = rnd() * 6.3;
      const a3 = sym() * 0.05 * k, p3 = rnd() * 6.3;
      const n = 40;
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const r = 0.95 + a2 * Math.sin(2 * th + p2) + a3 * Math.sin(3 * th + p3);
        pts.push(toPage([Math.cos(th) * r, Math.sin(th) * r]));
      }
      return { kind: 'blob', points: pts };
    }
    case 'strike':
      return strikeShape(a);
  }
}

/**
 * Cross-out marks: a horizontal stroke (or two, or a wave, or a zigzag) across
 * the w x h box centred on the stamp. With `rough` > 0 each stroke gets a pen
 * feel: a slight slope, low-frequency waviness, ends that over/undershoot, and
 * (for squiggles) an irregular wavelength and amplitude. All seeded.
 */
function strikeShape(a: StampAnnotation): StampShape {
  const style = a.strike ?? 'line';
  const k = clamp(a.rough ?? 0, 0, 1);
  const rnd = mulberry32(a.seed ?? 1);
  const sym = () => rnd() * 2 - 1;
  const hw = Math.max(a.w / 2 - a.stroke / 2, 0.25);
  const hh = Math.max(a.h / 2 - a.stroke / 2, 0);
  const len = hw * 2;
  const TAU = Math.PI * 2;

  /** One pen stroke across the width, sampled at n+1 points; `shape(t, i)` is the vertical offset at t in [0, 1]. */
  const pen = (base: number, n: number, shape: (t: number, i: number) => number): Pt[] => {
    let drift = 0, e0 = 0, e1 = 0, wander = 0, f1 = 1, p1 = 0;
    if (k > 0) {
      drift = sym() * (0.25 * a.h + 0.01 * len) * k; // overall slope
      e0 = sym() * 0.06 * len * k; // start over/undershoot
      e1 = sym() * 0.06 * len * k;
      wander = (0.1 * a.h + 0.12) * k; // slow waviness
      f1 = 1 + rnd() * 1.5;
      p1 = rnd() * TAU;
    }
    const x0 = a.x - hw - e0, x1 = a.x + hw + e1;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const dy = shape(t, i) + drift * (t - 0.5) + wander * Math.sin(TAU * f1 * t + p1);
      pts.push([x0 + (x1 - x0) * t, a.y + base + dy]);
    }
    return pts;
  };

  const straight = () => pen(0, k > 0 ? clamp(Math.round(len / 2), 12, 240) : 1, () => 0);

  switch (style) {
    case 'double': {
      const off = a.h / 4;
      const n = k > 0 ? clamp(Math.round(len / 2), 12, 240) : 1;
      return { kind: 'polylines', lines: [pen(-off, n, () => 0), pen(off, n, () => 0)] };
    }
    case 'squiggle': {
      const wl = 1.25 * a.h * (1 + sym() * 0.2 * k);
      const cycles = clamp(Math.round(len / Math.max(wl, 1)), 1, 400);
      const n = cycles * 16;
      // Irregular rhythm: warp the phase (zero at both ends so the stroke still ends on the centre line)
      // and let the amplitude breathe between 70% and 100% of the box.
      const f = 1 + Math.floor(rnd() * 3);
      const warp = (0.3 * k * cycles) / (TAU * f);
      const g = 1.5 + rnd() * 2, p2 = rnd() * TAU;
      const line = pen(0, n, (t) => {
        const phase = TAU * (cycles * t + warp * Math.sin(TAU * f * t));
        const amp = hh * (1 - 0.3 * k * (0.5 + 0.5 * Math.sin(TAU * g * t + p2)));
        return amp * Math.sin(phase);
      });
      return { kind: 'polylines', lines: [line] };
    }
    case 'scribble': {
      // Tight back-and-forth zigzag that blacks the word out.
      const step = Math.max(a.h * 0.3, a.stroke * 1.1);
      const m = clamp(Math.round(len / step), 2, 600);
      const line = pen(0, m, (_t, i) => (i % 2 ? 1 : -1) * hh * (1 - 0.35 * k * rnd()));
      return { kind: 'polylines', lines: [line] };
    }
    default:
      return { kind: 'polylines', lines: [straight()] };
  }
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * New size for a stamp (centred on orig.x/orig.y) whose corner handle is
 * dragged to `pt`. Proportional unless `free`, in which case w and h are
 * independent. Each dimension is at least 2 points before the aspect is applied.
 */
export function resizeStamp(orig: StampAnnotation, pt: Pt, free: boolean): { w: number; h: number } {
  let w = Math.max(2, Math.abs(pt[0] - orig.x) * 2);
  let h = Math.max(2, Math.abs(pt[1] - orig.y) * 2);
  if (!free) {
    const s = Math.max(w / orig.w, h / orig.h);
    w = orig.w * s;
    h = orig.h * s;
  }
  return { w, h };
}
