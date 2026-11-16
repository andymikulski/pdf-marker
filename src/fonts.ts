import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FontFamily, TextAnnotation } from './types';

// Handwriting fonts (Google Fonts, SIL Open Font License / Apache 2.0, via
// @fontsource). Inlined so they load the same way in the browser and in
// Electron's file:// pages.
import caveat from '@fontsource/caveat/files/caveat-latin-400-normal.woff?inline';
import patrickHand from '@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff?inline';
import kalam from '@fontsource/kalam/files/kalam-latin-400-normal.woff?inline';
import shadowsIntoLight from '@fontsource/shadows-into-light/files/shadows-into-light-latin-400-normal.woff?inline';
import indieFlower from '@fontsource/indie-flower/files/indie-flower-latin-400-normal.woff?inline';
import homemadeApple from '@fontsource/homemade-apple/files/homemade-apple-latin-400-normal.woff?inline';
import dancingScript from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?inline';
import nothingYouCouldDo from '@fontsource/nothing-you-could-do/files/nothing-you-could-do-latin-400-normal.woff?inline';

/**
 * Text layout is computed with the exact font metrics pdf-lib uses when
 * exporting, so line wrapping on screen matches the exported PDF.
 * - Standard fonts: the 14 built-in PDF fonts, shown on screen with
 *   metric-compatible system fonts (Arial / Times New Roman / Courier New).
 * - Handwriting fonts: the same font file is registered with the browser
 *   (FontFace) and embedded (subset) into the PDF.
 */

export interface FontDef {
  id: FontFamily;
  label: string;
  group: 'Handwriting' | 'Standard';
  /** CSS font-family for on-screen rendering */
  css: string;
  standard?: StandardFonts;
  /** data: URL of the font file (custom fonts) */
  data?: string;
}

const hand = (id: FontFamily, label: string, data: string): FontDef => ({
  id,
  label,
  group: 'Handwriting',
  css: `'PM ${label}', cursive`,
  data,
});

export const FONTS: FontDef[] = [
  hand('Caveat', 'Caveat', caveat),
  hand('PatrickHand', 'Patrick Hand', patrickHand),
  hand('Kalam', 'Kalam', kalam),
  hand('ShadowsIntoLight', 'Shadows Into Light', shadowsIntoLight),
  hand('IndieFlower', 'Indie Flower', indieFlower),
  hand('NothingYouCouldDo', 'Nothing You Could Do', nothingYouCouldDo),
  hand('HomemadeApple', 'Homemade Apple', homemadeApple),
  hand('DancingScript', 'Dancing Script', dancingScript),
  { id: 'Helvetica', label: 'Helvetica', group: 'Standard', css: "Helvetica, Arial, 'Liberation Sans', sans-serif", standard: StandardFonts.Helvetica },
  { id: 'Times', label: 'Times', group: 'Standard', css: "'Times New Roman', Times, 'Liberation Serif', serif", standard: StandardFonts.TimesRoman },
  { id: 'Courier', label: 'Courier', group: 'Standard', css: "'Courier New', Courier, 'Liberation Mono', monospace", standard: StandardFonts.Courier },
];

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));
export const fontDef = (id: FontFamily) => BY_ID.get(id) ?? BY_ID.get('Helvetica')!;
export const cssFont = (id: FontFamily) => fontDef(id).css;

/**
 * Vertical metrics as fractions of the font size:
 * `descent` positions baselines in our layout; `asc`/`desc` are what the
 * browser uses for a line box (used to align the inline text editor).
 * Standard fonts use the AFM descenders and the on-screen stand-ins' metrics.
 */
const STANDARD_METRICS: Partial<Record<FontFamily, { descent: number; asc: number; desc: number }>> = {
  Helvetica: { descent: 0.207, asc: 0.905, desc: 0.212 },
  Times: { descent: 0.217, asc: 0.891, desc: 0.216 },
  Courier: { descent: 0.157, asc: 0.833, desc: 0.3 },
};

/** Baseline height above the bottom of each line for handwriting fonts (fraction of size), ~Helvetica's. */
const HAND_BASELINE_DROP = 0.21;

interface Loaded {
  font: PDFFont;
  charset: Set<number>;
  bytes?: Uint8Array;
  descent: number;
  asc: number;
  desc: number;
}
const loaded = new Map<FontFamily, Loaded>();

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function initFonts() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const faces: Promise<unknown>[] = [];
  for (const def of FONTS) {
    if (def.standard) {
      const font = await doc.embedFont(def.standard);
      loaded.set(def.id, { font, charset: new Set(font.getCharacterSet()), ...STANDARD_METRICS[def.id]! });
    } else {
      const bytes = dataUrlBytes(def.data!);
      const font = await doc.embedFont(bytes, { subset: true });
      // asc/desc: the font's declared line metrics, which is what the browser
      // uses to lay out the inline editor. The baseline drop is deliberately
      // NOT the declared descender: handwriting fonts often declare huge ones
      // (Kalam 0.53em, Homemade Apple 0.87em) and their text would float to the
      // top of the box. Sit every line on its band like Helvetica does, and let
      // long tails hang below as real handwriting would.
      const full = font.heightAtSize(1);
      const asc = font.heightAtSize(1, { descender: false });
      loaded.set(def.id, { font, bytes, charset: new Set(font.getCharacterSet()), descent: HAND_BASELINE_DROP, asc, desc: full - asc });
      if (typeof document !== 'undefined' && 'FontFace' in globalThis) {
        const face = new FontFace(`PM ${def.label}`, bytes.slice().buffer as ArrayBuffer);
        document.fonts.add(face);
        faces.push(face.load().catch((e) => console.warn(`font ${def.label} failed to load`, e)));
      }
    }
  }
  await Promise.all(faces);
}

function m(fam: FontFamily) {
  const v = loaded.get(fam) ?? loaded.get('Helvetica');
  if (!v) throw new Error('initFonts() has not completed');
  return v;
}

/** Embed a font into an export document (custom fonts are subset). */
export async function embedFontInto(doc: PDFDocument, fam: FontFamily): Promise<PDFFont> {
  const def = fontDef(fam);
  if (def.standard) return doc.embedFont(def.standard);
  doc.registerFontkit(fontkit);
  return doc.embedFont(m(def.id).bytes!, { subset: true });
}

export function editorMetrics(fam: FontFamily) {
  const { asc, desc, descent } = m(fam);
  return { asc, desc, descent };
}

/** Replace characters the font can't draw with '?'. */
export function sanitize(text: string, fam: FontFamily): string {
  const { charset } = m(fam);
  let out = '';
  for (const ch of text.replace(/\t/g, '    ')) {
    out += charset.has(ch.codePointAt(0)!) ? ch : '?';
  }
  return out;
}

export function textWidth(text: string, fam: FontFamily, size: number): number {
  return m(fam).font.widthOfTextAtSize(sanitize(text, fam), size);
}

/** Greedy word-wrap. Explicit newlines are kept; over-long words are broken. */
export function wrapText(text: string, fam: FontFamily, size: number, width: number): string[] {
  const out: string[] = [];
  const fits = (s: string) => textWidth(s, fam, size) <= width;
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      const candidate = line === '' ? word : line + ' ' + word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line !== '') out.push(line);
      // Break a word that is wider than the whole box.
      let rest = word;
      while (rest.length > 1 && !fits(rest)) {
        let n = rest.length - 1;
        while (n > 1 && !fits(rest.slice(0, n))) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export interface LaidOutLine {
  text: string;
  /** left x and baseline y in displayed-page space */
  x: number;
  baseline: number;
}

/**
 * Line i occupies the band [y + i*lineHeight, y + (i+1)*lineHeight] and sits
 * on the bottom of that band, so a box whose top is on a form's first writing
 * line, with lineHeight = the ruling spacing, puts every line on a rule.
 */
export function layoutText(a: TextAnnotation): LaidOutLine[] {
  const lines = wrapText(a.text, a.font, a.size, a.w);
  const drop = m(a.font).descent * a.size;
  return lines.map((text, i) => ({
    text: sanitize(text, a.font),
    x: a.x,
    baseline: a.y + (i + 1) * a.lineHeight - drop,
  }));
}