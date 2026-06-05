import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Branded social-preview card. Next.js wires this into the `og:image` (and, as a
// fallback, the Twitter card) for every page. 1200x630 is the standard size.
// Fonts are loaded from local woff files so the card pixel-matches the site:
// Space Grotesk for the headline, Inter for body — same as the live pages.
export const alt = "Context101 — One brain. Every AI tool.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const fontsDir = join(process.cwd(), "app", "_og-fonts");
  const [grotesk700, inter400, inter500] = await Promise.all([
    readFile(join(fontsDir, "space-grotesk-700.woff")),
    readFile(join(fontsDir, "inter-400.woff")),
    readFile(join(fontsDir, "inter-500.woff")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "88px",
          color: "#f2eef8",
          backgroundColor: "#060509",
          backgroundImage:
            "radial-gradient(900px circle at 18% 12%, rgba(184,85,201,0.32), transparent 55%), radial-gradient(700px circle at 92% 96%, rgba(139,92,246,0.22), transparent 55%)",
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#a89eb4",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              backgroundColor: "#b855c9",
            }}
          />
          Context101
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 40,
            fontFamily: "Space Grotesk",
            fontWeight: 700,
            fontSize: 110,
            lineHeight: 0.95,
            letterSpacing: "-0.06em",
          }}
        >
          <div style={{ display: "flex" }}>One brain.</div>
          <div style={{ display: "flex", color: "#b855c9" }}>
            Every AI tool.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 44,
            maxWidth: 880,
            fontSize: 34,
            lineHeight: 1.35,
            color: "#a89eb4",
          }}
        >
          One MCP knowledge base for Cursor, Claude, Devin, and your own agents.
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            fontSize: 26,
            color: "#8a7f97",
          }}
        >
          context101.dev
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Space Grotesk",
          data: grotesk700,
          weight: 700,
          style: "normal",
        },
        { name: "Inter", data: inter400, weight: 400, style: "normal" },
        { name: "Inter", data: inter500, weight: 500, style: "normal" },
      ],
    }
  );
}
