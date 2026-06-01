import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SiteBackground } from "@/components/site-background";
import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Context101",
  description:
    "An open-source alpha MCP knowledge base for trusted internal teams.",
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
    <html lang="en" className={bodyFont.variable}>
      <body>
        <SiteBackground />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
