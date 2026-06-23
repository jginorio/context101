import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { fontVariables } from "@context101/ui/fonts";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BrainProvider } from "@/lib/brain-context";

export const metadata: Metadata = {
  title: "Context101",
  description: "Self-hosted MCP knowledge base admin app",
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
      suppressHydrationWarning
      className={`dark ${fontVariables} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {/* BrainProvider reads `useSearchParams`, so it has to sit inside a
              Suspense boundary in Next 16 to keep static pages out of forced
              dynamic rendering. */}
          <Suspense fallback={null}>
            <BrainProvider>{children}</BrainProvider>
          </Suspense>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
