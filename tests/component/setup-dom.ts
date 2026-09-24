import { vi } from 'vitest';

/** jsdom lacks matchMedia and scrollTo; components read both. */
export function installDom({ reducedMotion = false, dark = false } = {}): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      matches: q.includes('reduce') ? reducedMotion : q.includes('dark') ? dark : false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  if (!('requestAnimationFrame' in window)) (window as unknown as { requestAnimationFrame: (f: () => void) => void }).requestAnimationFrame = (f) => setTimeout(f, 0);
}
