'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

// Adds or removes the `dark` class on <html>; shadcn's colors switch on it.
// Follows the OS setting until the user picks a theme with the toggle.
export function ThemeProvider(
  props: ComponentProps<typeof NextThemesProvider>,
) {
  return <NextThemesProvider {...props} />;
}
