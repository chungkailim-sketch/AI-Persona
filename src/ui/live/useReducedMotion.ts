'use client';
import { useEffect, useState } from 'react';

/** True when the user asked the OS for less motion. Server render assumes reduced (no animation). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Motion decisions in one place, so a component never has to reason about the preference itself. */
export function motionFor(reduced: boolean) {
  return {
    scrollBehavior: (reduced ? 'auto' : 'smooth') as ScrollBehavior,
    animateFlow: !reduced,
    pulse: !reduced,
    enterClass: reduced ? '' : 'motion-enter',
  };
}
