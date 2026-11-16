/**
 * All annotation coordinates are in PDF points (1/72"), in the page's
 * *displayed* orientation, with the origin at the top-left of the page.
 * Conversion to real PDF user space (which may be rotated / offset) only
 * happens at export time (see geometry.ts).
 */

export type StampKind = 'circle' | 'x' | 'check' | 'dot' | 'strike';
/** look of a 'strike' (cross-out) stamp */
export type StrikeStyle = 'line' | 'double' | 'squiggle' | 'scribble';
export type Tool = 'select' | StampKind | 'text';
export type FontFamily =
  | 'Helvetica'
  | 'Times'
  | 'Courier'
  | 'Caveat'
  | 'PatrickHand'
  | 'Kalam'
  | 'ShadowsIntoLight'
  | 'IndieFlower'
  | 'NothingYouCouldDo'
  | 'HomemadeApple'
  | 'DancingScript';

interface BaseAnnotation {
  id: string;
  /** 0-based page index */
  page: number;
  /** #rrggbb */
  color: string;
}

export interface StampAnnotation extends BaseAnnotation {
  type: 'stamp';
  kind: StampKind;
  /** center */
  x: number;
  y: number;
  w: number;
  h: number;
  /** line width in points (ignored for dots) */
  stroke: number;
  /** hand-drawn wobble, 0 = clean geometric shape, up to 1 */
  rough?: number;
  /** random seed that makes each hand-drawn stamp look different (but stable) */
  seed?: number;
  /** cross-out look; only used when kind === 'strike' (default 'line') */
  strike?: StrikeStyle;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  /** top-left of the text box */
  x: number;
  y: number;
  /** box width: text word-wraps to this */
  w: number;
  /** box height: purely a guide, text may overflow it */
  h: number;
  text: string;
  font: FontFamily;
  /** font size in points */
  size: number;
  /** distance between baselines, in points */
  lineHeight: number;
}

export type Annotation = StampAnnotation | TextAnnotation;

export interface PageInfo {
  /** displayed size in points (after /Rotate) */
  width: number;
  height: number;
  /** /Rotate, normalized to 0 | 90 | 180 | 270 */
  rotation: number;
  /** pdf.js `view` box (crop box) in user space: [x0, y0, x1, y1] */
  view: [number, number, number, number];
}

export interface StampDefaults {
  w: number;
  h: number;
  stroke: number;
}

export interface Defaults {
  color: string;
  stamps: Record<StampKind, StampDefaults>;
  text: { font: FontFamily; size: number; lineHeight: number; w: number };
  /** hand-drawn style for new stamps */
  hand: { on: boolean; amount: number };
  /** look of new cross-outs */
  strike: { style: StrikeStyle };
}

export const DEFAULTS: Defaults = {
  color: '#1a1aa6',
  stamps: {
    circle: { w: 16, h: 16, stroke: 1.5 },
    x: { w: 10, h: 10, stroke: 1.5 },
    check: { w: 12, h: 12, stroke: 1.75 },
    dot: { w: 8, h: 8, stroke: 0 },
    strike: { w: 60, h: 6, stroke: 1.25 },
  },
  text: { font: 'Helvetica', size: 11, lineHeight: 14, w: 220 },
  hand: { on: false, amount: 0.6 },
  strike: { style: 'line' },
};

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
