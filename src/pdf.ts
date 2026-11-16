import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageInfo } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (p: string) => new URL(`pdfjs/${p}/`, document.baseURI).href;

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  pages: PageInfo[];
  /** untouched original bytes (pdf.js detaches the buffer it is given) */
  bytes: Uint8Array;
  fingerprint: string;
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
  }).promise;

  const pages: PageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const [a, b, c, d] = page.view;
    pages.push({
      width: vp.width,
      height: vp.height,
      rotation: ((page.rotate % 360) + 360) % 360,
      view: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)],
    });
  }
  return { doc, pages, bytes, fingerprint: await contentHash(bytes, doc.fingerprints[0] ?? '') };
}

/**
 * Autosave key. Hash the actual bytes rather than using the PDF's /ID
 * fingerprint, because exported copies keep the original's /ID and must not
 * get the original's marks re-applied on top.
 */
async function contentHash(bytes: Uint8Array, fallback: string) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${fallback}-${bytes.length}`;
  }
}
