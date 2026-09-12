import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { fontVariables } from "@context101/ui/fonts";
import { SiteBackground } from "@/components/site-background";
import "./globals.css";

const SITE_URL = "https://context101.dev";
const TITLE = "Context101 — Your context. Every agent.";
const DESCRIPTION =
  "A thin open-source wrapper around Amazon Bedrock Knowledge Bases. Self-host it in your AWS account. Agents retrieve the same docs through MCP. Hosted later — not yet.";

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
    "Amazon Bedrock",
    "Knowledge Bases",
    "MCP",
    "self-host",
    "AWS",
    "S3 Vectors",
    "Cursor",
    "Claude",
    "open source",
    "alpha",
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
