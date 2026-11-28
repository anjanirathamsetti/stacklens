'use client';

import { createContext, useContext } from 'react';
import type { Language } from '@stacklens/shared/language';

/**
 * Language of the trace being shown (from `trace.sdk`, see `@stacklens/shared/language`). Value views and
 * signatures read it to use the language's idioms: `None`/`True`, `list(3)`, `async def f() -> int`.
 */
const LanguageContext = createContext<Language>('node');

export const LanguageProvider = LanguageContext.Provider;
export const useLanguage = (): Language => useContext(LanguageContext);
