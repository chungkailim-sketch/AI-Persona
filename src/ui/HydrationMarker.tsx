'use client';

import { useEffect } from 'react';

/**
 * Sets `data-hydrated` on the document once React has taken over on the client.
 *
 * This exists for end-to-end tests: without a signal, a test can click a control that is rendered
 * but not yet interactive and silently observe nothing happening — a flake that looks like a bug,
 * or worse, hides one. It renders nothing, affects no layout, and is not read by application code.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);
  return null;
}
