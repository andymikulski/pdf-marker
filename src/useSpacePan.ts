import { useEffect } from 'react';

/**
 * Hold Space to turn the document area into a "hand tool": the cursor becomes
 * grab / grabbing and left-dragging scrolls `el` 1:1 with the mouse.
 *
 * While Space is held every pointerdown on `el` is swallowed in the capture
 * phase (before React's root listeners see it), so no stamps are placed, nothing
 * is selected or moved, and no text boxes are started. Space is ignored entirely
 * while typing in an input / textarea / select.
 *
 * Styling hooks (see the end of styles.css): `.panning` while Space is held or a
 * pan is in progress, plus `.grabbing` while the mouse button is down.
 */
export function useSpacePan(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return;
    let spaceDown = false;
    let pan: { id: number; x: number; y: number; left: number; top: number } | null = null;

    const sync = () => {
      el.classList.toggle('panning', spaceDown || !!pan);
      el.classList.toggle('grabbing', !!pan);
    };
    const endPan = () => {
      if (!pan) return;
      const { id } = pan;
      pan = null;
      if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
      sync();
    };
    const release = () => {
      spaceDown = false;
      endPan();
      sync();
    };

    const isTyping = (t: EventTarget | null) => {
      const tag = (t as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(t as HTMLElement | null)?.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      e.preventDefault(); // no page scroll, no activating a focused button
      if (e.repeat || spaceDown) return;
      spaceDown = true;
      sync();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (spaceDown) e.preventDefault(); // a focused button would otherwise "click" on Space keyup
      spaceDown = false;
      sync(); // an in-progress drag keeps panning until the mouse is released
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!spaceDown) return;
      // Leave the native scrollbar alone.
      if (e.target === el && (e.offsetX >= el.clientWidth || e.offsetY >= el.clientHeight)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0 || pan) return;
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture(e.pointerId);
      sync();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.id) return;
      el.scrollLeft = pan.left - (e.clientX - pan.x);
      el.scrollTop = pan.top - (e.clientY - pan.y);
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (pan && e.pointerId === pan.id) endPan();
    };
    // Swallow the click / double-click that follows a pan so it can't reach the page.
    const swallow = (e: MouseEvent) => {
      if (spaceDown || pan) e.stopPropagation();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', release);
    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('click', swallow, true);
    el.addEventListener('dblclick', swallow, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', release);
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('click', swallow, true);
      el.removeEventListener('dblclick', swallow, true);
      release();
    };
  }, [el]);
}
