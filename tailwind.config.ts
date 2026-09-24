import type { Config } from 'tailwindcss';

/**
 * Tailwind consumes CSS custom properties only. No literal brand value, duration or easing appears
 * here, so the brand kit and the motion system can be swapped in `app/globals.css` alone.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        elevated: 'var(--color-elevated)',
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        input: 'var(--color-input)',
        telemetry: 'var(--color-telemetry)',
        'telemetry-ink': 'var(--color-telemetry-ink)',
        code: 'var(--color-code)',
        overlay: 'var(--color-overlay)',
        ink: 'var(--color-ink)',
        'ink-muted': 'var(--color-ink-muted)',
        'ink-subtle': 'var(--color-ink-subtle)',
        link: 'var(--color-link)',
        line: 'var(--color-line)',
        'line-strong': 'var(--color-line-strong)',
        brand: 'var(--color-brand)',
        'brand-ink': 'var(--color-brand-ink)',
        'brand-soft': 'var(--color-brand-soft)',
        ok: 'var(--color-ok)', 'ok-soft': 'var(--color-ok-soft)',
        warn: 'var(--color-warn)', 'warn-soft': 'var(--color-warn-soft)',
        danger: 'var(--color-danger)', 'danger-soft': 'var(--color-danger-soft)',
        info: 'var(--color-info)', 'info-soft': 'var(--color-info-soft)',
        pending: 'var(--color-pending)', 'pending-soft': 'var(--color-pending-soft)',
        observed: 'var(--color-observed)',
        derived: 'var(--color-derived)',
        inferred: 'var(--color-inferred)',
        simulated: 'var(--color-simulated)',
        track: 'var(--chart-track)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      borderRadius: { sm: 'var(--radius-sm)', DEFAULT: 'var(--radius)', lg: 'var(--radius-lg)' },
      boxShadow: { card: 'var(--shadow-card)', pop: 'var(--shadow-pop)' },
      maxWidth: { content: 'var(--width-content)', wide: 'var(--width-wide)', prose: 'var(--width-prose)' },
      transitionDuration: {
        instant: 'var(--motion-instant)',
        fast: 'var(--motion-fast)',
        base: 'var(--motion-standard)',
        standard: 'var(--motion-standard)',
        deliberate: 'var(--motion-deliberate)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        enter: 'var(--ease-enter)',
        exit: 'var(--ease-exit)',
      },
    },
  },
  plugins: [],
};
export default config;
