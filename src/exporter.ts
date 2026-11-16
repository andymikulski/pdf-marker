import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { stampShape, toPdfPoint, type Pt } from './geometry';
import { embedFontInto, layoutText } from './fonts';
import { embedProject, type Project } from './project';
import type { Annotation, FontFamily, PageInfo } from './types';

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function drawAnnotations(
  doc: PDFDocument,
  pdfPages: PDFPage[],
  infos: PageInfo[],
  annots: Annotation[],
) {
  const fonts = new Map<FontFamily, PDFFont>();
  const font = async (f: FontFamily) => {
    if (!fonts.has(f)) fonts.set(f, await embedFontInto(doc, f));
    return fonts.get(f)!;
  };

  for (const a of annots) {
    const page = pdfPages[a.page];
    const info = infos[a.page];
    if (!page || !info) continue;
    const color = hexToRgb(a.color);
    const P = (x: number, y: number) => {
      const [px, py] = toPdfPoint(info, x, y);
      return { x: px, y: py };
    };
    const sideways = info.rotation === 90 || info.rotation === 270;

    if (a.type === 'stamp') {
      const s = stampShape(a);
      if (s.kind === 'ellipse') {
        const c = P(s.cx, s.cy);
        page.drawEllipse({
          ...c,
          xScale: sideways ? s.ry : s.rx,
          yScale: sideways ? s.rx : s.ry,
          ...(s.filled
            ? { color }
            : { borderColor: color, borderWidth: a.stroke }),
        });
      } else {
        // drawSvgPath maps (u, v) to (x + u, y - v), so negate y to stay in PDF space.
        const path = (pts: Pt[], close: boolean) =>
          pts
            .map(([x, y], i) => {
              const p = P(x, y);
              return `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${(-p.y).toFixed(3)}`;
            })
            .join(' ') + (close ? ' Z' : '');
        page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
        if (s.kind === 'blob') {
          page.drawSvgPath(path(s.points, true), { x: 0, y: 0, color });
        } else {
          for (const line of s.lines) {
            page.drawSvgPath(path(line, false), {
              x: 0,
              y: 0,
              borderColor: color,
              borderWidth: a.stroke,
              borderLineCap: LineCapStyle.Round,
            });
          }
        }
        page.pushOperators(popGraphicsState());
      }
    } else {
      const f = await font(a.font);
      for (const line of layoutText(a)) {
        if (!line.text) continue;
        page.drawText(line.text, {
          ...P(line.x, line.baseline),
          size: a.size,
          font: f,
          color,
          rotate: degrees(info.rotation),
        });
      }
    }
  }
}

async function finish(doc: PDFDocument, project?: Project) {
  if (project) embedProject(doc, project);
  // No object streams: keeps the project marker findable with a byte scan.
  return doc.save({ useObjectStreams: false });
}

/** Draw annotations as vector content on top of the original PDF pages. */
export async function exportVector(bytes: Uint8Array, infos: PageInfo[], annots: Annotation[], project?: Project) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  await drawAnnotations(doc, doc.getPages(), infos, annots);
  return finish(doc, project);
}

/**
 * Fallback for PDFs pdf-lib can't parse: render every page to an image with
 * pdf.js and build a brand-new PDF from those images plus the annotations.
 */
export async function exportRaster(
  src: PDFDocumentProxy,
  infos: PageInfo[],
  annots: Annotation[],
  project?: Project,
  dpi = 200,
) {
  const doc = await PDFDocument.create();
  const pages: PDFPage[] = [];
  const flatInfos: PageInfo[] = [];
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    const p = await src.getPage(i + 1);
    const vp = p.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.9));
    const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = doc.addPage([info.width, info.height]);
    page.drawImage(img, { x: 0, y: 0, width: info.width, height: info.height });
    pages.push(page);
    flatInfos.push({ width: info.width, height: info.height, rotation: 0, view: [0, 0, info.width, info.height] });
  }
  await drawAnnotations(doc, pages, flatInfos, annots);
  return finish(doc, project);
}
