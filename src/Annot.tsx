import { stampShape } from './geometry';
import { cssFont, layoutText } from './fonts';
import type { Annotation, StampAnnotation, TextAnnotation } from './types';

export function StampGraphic({ a, opacity }: { a: StampAnnotation; opacity?: number }) {
  const s = stampShape(a);
  if (s.kind === 'ellipse') {
    return (
      <ellipse
        cx={s.cx}
        cy={s.cy}
        rx={s.rx}
        ry={s.ry}
        fill={s.filled ? a.color : 'none'}
        stroke={s.filled ? 'none' : a.color}
        strokeWidth={a.stroke}
        opacity={opacity}
        pointerEvents="none"
      />
    );
  }
  if (s.kind === 'blob') {
    return (
      <polygon points={s.points.map((p) => p.join(',')).join(' ')} fill={a.color} opacity={opacity} pointerEvents="none" />
    );
  }
  return (
    <g opacity={opacity} pointerEvents="none">
      {s.lines.map((pts, i) => (
        <polyline
          key={i}
          points={pts.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={a.color}
          strokeWidth={a.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

export function TextGraphic({ a, hideText }: { a: TextAnnotation; hideText?: boolean }) {
  if (hideText) return null;
  return (
    <text
      fontFamily={cssFont(a.font)}
      fontSize={a.size}
      fill={a.color}
      style={{ whiteSpace: 'pre' }}
      pointerEvents="none"
    >
      {layoutText(a).map((l, i) => (
        <tspan key={i} x={l.x} y={l.baseline}>
          {l.text}
        </tspan>
      ))}
    </text>
  );
}

/** Bounding box in page space, used for hit-testing and the selection outline. */
export function bounds(a: Annotation) {
  if (a.type === 'stamp') return { x: a.x - a.w / 2, y: a.y - a.h / 2, w: a.w, h: a.h };
  const lines = layoutText(a).length;
  return { x: a.x, y: a.y, w: a.w, h: Math.max(a.h, lines * a.lineHeight) };
}
