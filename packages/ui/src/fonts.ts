import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

/**
 * Font configuration for the Context101 admin (`web/`). Import the instances
 * and spread `fontVariables` onto <html> so the CSS vars (--font-body /
 * --font-display / --font-mono-code) resolve. tokens.css wires those vars to
 * body / headings / mono.
 */
export const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

export const monoFont = JetBrains_Mono({
  variable: "--font-mono-code",
  subsets: ["latin"],
});

export const fontVariables = `${bodyFont.variable} ${displayFont.variable} ${monoFont.variable}`;
