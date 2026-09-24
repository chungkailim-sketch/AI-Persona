'use client';
import type { ReactNode } from 'react';
import { useReducedMotion } from '../live/useReducedMotion';

/** Render `animated` normally and `still` when reduced motion is requested. Both carry the same meaning. */
export function ReducedMotionFallback({ animated, still }: { animated: ReactNode; still: ReactNode }) {
  const reduced = useReducedMotion();
  return <>{reduced ? still : animated}</>;
}
