import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { Annotation } from './types';

/**
 * "Projects" live inside the exported PDF itself. Next to the flattened marks,
 * an export can carry a hidden catalog entry holding the untouched original
 * PDF and the marks as data:
 *
 *   /PDFMarkerProject << /Version 1 /Data <json stream> /Original <pdf stream> >>
 *
 * PDF viewers ignore unknown catalog keys, so the file looks normal everywhere
 * else. When PDF Marker opens it, it loads the original underneath and makes
 * the marks editable again, so nothing gets drawn twice.
 */

const KEY = 'PDFMarkerProject';

export interface ProjectData {
  version: 1;
  /** file name of the original PDF */
  name: string;
  annots: Annotation[];
}

export interface Project {
  original: Uint8Array;
  data: ProjectData;
}

export function embedProject(doc: PDFDocument, project: Project) {
  const ctx = doc.context;
  // Encode as UTF-8 ourselves: pdf-lib would truncate a JS string to 8-bit chars.
  const json = new TextEncoder().encode(JSON.stringify(project.data));
  const dataRef = ctx.register(ctx.flateStream(json));
  const origRef = ctx.register(ctx.stream(project.original));
  doc.catalog.set(PDFName.of(KEY), ctx.obj({ Version: 1, Data: dataRef, Original: origRef }));
}

/** Returns the embedded project, or null for an ordinary PDF. */
export async function extractProject(bytes: Uint8Array): Promise<Project | null> {
  // Cheap check first so ordinary PDFs aren't parsed a second time. Exports are
  // saved without object streams, so the catalog key is plain text in the file.
  if (!containsAscii(bytes, '/' + KEY)) return null;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const dict = doc.catalog.lookupMaybe(PDFName.of(KEY), PDFDict);
    if (!dict) return null;
    const dataStream = dict.lookup(PDFName.of('Data'));
    const origStream = dict.lookup(PDFName.of('Original'));
    if (!(dataStream instanceof PDFRawStream) || !(origStream instanceof PDFRawStream)) return null;
    const data = JSON.parse(new TextDecoder().decode(decodePDFRawStream(dataStream).decode())) as ProjectData;
    if (data.version !== 1 || !Array.isArray(data.annots)) return null;
    return { original: decodePDFRawStream(origStream).decode(), data };
  } catch (err) {
    console.warn('Found a PDF Marker project marker but could not read it', err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Standalone project files (.pdfmark): readable JSON holding the marks plus
 * the original PDF (base64), so one file is everything needed to keep working.
 * ------------------------------------------------------------------------- */

export const PROJECT_EXT = '.pdfmark';

interface ProjectFileJson {
  app: 'pdf-marker';
  version: 1;
  name: string;
  savedAt: string;
  annots: Annotation[];
  /** the original PDF, base64 */
  pdf: string;
}

export function serializeProjectFile(p: Project): Blob {
  const json: ProjectFileJson = {
    app: 'pdf-marker',
    version: 1,
    name: p.data.name,
    savedAt: new Date().toISOString(),
    annots: p.data.annots,
    pdf: toBase64(p.original),
  };
  // Marks first and pretty-printed so the file is readable; the big blob last.
  return new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' });
}

export function isProjectFile(name: string, head: Uint8Array) {
  return name.toLowerCase().endsWith(PROJECT_EXT) || head[0] === 0x7b; /* '{' */
}

export function parseProjectFile(bytes: Uint8Array): Project {
  const json = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ProjectFileJson>;
  if (json.app !== 'pdf-marker' || json.version !== 1 || !Array.isArray(json.annots) || typeof json.pdf !== 'string') {
    throw new Error('not a PDF Marker project file');
  }
  return {
    original: fromBase64(json.pdf),
    data: { version: 1, name: json.name ?? 'document.pdf', annots: json.annots },
  };
}

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function containsAscii(hay: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  const first = n[0];
  outer: for (let i = hay.indexOf(first); i !== -1 && i <= hay.length - n.length; i = hay.indexOf(first, i + 1)) {
    for (let j = 1; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}
