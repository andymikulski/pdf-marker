import { DEFAULTS, type Annotation, type Defaults } from './types';

const DEFAULTS_KEY = 'pdf-marker:defaults';
const docKey = (fingerprint: string) => `pdf-marker:doc:${fingerprint}`;

export function loadDefaults(): Defaults {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<Defaults>;
    return {
      color: v.color ?? DEFAULTS.color,
      stamps: { ...DEFAULTS.stamps, ...v.stamps },
      text: { ...DEFAULTS.text, ...v.text },
      hand: { ...DEFAULTS.hand, ...v.hand },
      strike: { ...DEFAULTS.strike, ...v.strike },
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveDefaults(d: Defaults) {
  localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));
}

/** Annotations are auto-saved per document, keyed by the PDF's fingerprint. */
export function loadDocAnnotations(fingerprint: string): Annotation[] {
  try {
    const raw = localStorage.getItem(docKey(fingerprint));
    return raw ? (JSON.parse(raw).annots as Annotation[]) : [];
  } catch {
    return [];
  }
}

export function saveDocAnnotations(fingerprint: string, name: string, annots: Annotation[]) {
  try {
    if (annots.length) {
      localStorage.setItem(docKey(fingerprint), JSON.stringify({ name, savedAt: Date.now(), annots }));
    } else {
      localStorage.removeItem(docKey(fingerprint));
    }
  } catch {
    /* quota exceeded – autosave is best-effort */
  }
}
