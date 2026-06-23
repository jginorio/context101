import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { fontVariables } from "@context101/ui/fonts";
import { SiteBackground } from "@/components/site-background";
import "./globals.css";

const SITE_URL = "https://context101.dev";
const TITLE = "Context101 — One brain. Every AI tool.";
const DESCRIPTION =
  "Context101 is an MCP knowledge base that gives Cursor, Claude, Devin, and your own agents one shared, approved source of truth. Use the hosted app, or self-host the open source.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Context101",
  },
  description: DESCRIPTION,
  applicationName: "Context101",
  keywords: [
    "Context101",
    "MCP",
    "knowledge base",
    "AI agents",
    "Cursor",
    "Claude",
    "Devin",
    "shared context",
    "open source",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Context101",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={fontVariables}
    >
      <body>
        <SiteBackground />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
