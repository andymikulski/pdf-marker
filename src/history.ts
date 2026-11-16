import { useCallback, useReducer } from 'react';
import type { Annotation } from './types';

interface State {
  present: Annotation[];
  past: Annotation[][];
  future: Annotation[][];
}

type Action =
  | { type: 'reset'; annots: Annotation[] }
  /** commit: push the previous state (or `base`) onto the undo stack */
  | { type: 'update'; fn: (a: Annotation[]) => Annotation[]; commit: boolean }
  /** close a run of transient updates (drag, typing) as one undo step */
  | { type: 'checkpoint'; base: Annotation[] }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 300;

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'reset':
      return { present: a.annots, past: [], future: [] };
    case 'update': {
      const next = a.fn(s.present);
      if (next === s.present) return s;
      return a.commit
        ? { present: next, past: [...s.past, s.present].slice(-LIMIT), future: [] }
        : { ...s, present: next };
    }
    case 'checkpoint':
      if (a.base === s.present) return s;
      return { ...s, past: [...s.past, a.base].slice(-LIMIT), future: [] };
    case 'undo': {
      if (!s.past.length) return s;
      return { present: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.present, ...s.future] };
    }
    case 'redo': {
      if (!s.future.length) return s;
      return { present: s.future[0], past: [...s.past, s.present], future: s.future.slice(1) };
    }
  }
}

export function useAnnotationHistory() {
  const [state, dispatch] = useReducer(reducer, { present: [], past: [], future: [] });
  return {
    annots: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    reset: useCallback((annots: Annotation[]) => dispatch({ type: 'reset', annots }), []),
    update: useCallback(
      (fn: (a: Annotation[]) => Annotation[], commit = true) => dispatch({ type: 'update', fn, commit }),
      [],
    ),
    checkpoint: useCallback((base: Annotation[]) => dispatch({ type: 'checkpoint', base }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
  };
}

export type AnnotationHistory = ReturnType<typeof useAnnotationHistory>;
