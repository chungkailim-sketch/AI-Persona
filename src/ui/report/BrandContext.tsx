'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** The client logo the deck shows in place of the Ruder Finn and rf.AI Persona logos, if any. */
const BrandLogo = createContext<{ logo: string | null; name: string | null }>({ logo: null, name: null });

export function BrandProvider({ logo, name, children }: { logo: string | null; name: string | null; children: ReactNode }) {
  return <BrandLogo.Provider value={{ logo, name }}>{children}</BrandLogo.Provider>;
}

export const useBrandLogo = () => useContext(BrandLogo);
