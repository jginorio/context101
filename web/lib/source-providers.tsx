import type { ComponentType } from "react";
import { Plug } from "lucide-react";

import {
  GithubLogo,
  GoogleDocsLogo,
  GoogleLogo,
  GoogleSheetsLogo,
  GoogleSlidesLogo,
  NotionLogo,
} from "@/components/source-logos";

// Any component that accepts a className — covers both the brand SVG marks
// and Lucide icons.
export type SourceIcon = ComponentType<{ className?: string }>;

// Connector types that surface in the UI. Mirrors the Postgres `source_type`
// enum minus `manual` (manual files are created directly in the Knowledge UI,
// not through a connector).
export type ConnectorType = "sheets" | "docs" | "slides" | "notion" | "github";

export type SourceTypeMeta = {
  type: ConnectorType;
  // Short label used under a provider group, e.g. "Docs".
  label: string;
  // Standalone label used in add-source menus, e.g. "Google Docs".
  menuLabel: string;
  icon: SourceIcon;
  // S3 prefix where this connector's synced files land.
  prefix: string;
};

export const SOURCE_TYPES: Record<ConnectorType, SourceTypeMeta> = {
  docs: {
    type: "docs",
    label: "Docs",
    menuLabel: "Google Docs",
    icon: GoogleDocsLogo,
    prefix: "sources/docs/",
  },
  sheets: {
    type: "sheets",
    label: "Sheets",
    menuLabel: "Google Sheets",
    icon: GoogleSheetsLogo,
    prefix: "sources/sheets/",
  },
  slides: {
    type: "slides",
    label: "Slides",
    menuLabel: "Google Slides",
    icon: GoogleSlidesLogo,
    prefix: "sources/slides/",
  },
  notion: {
    type: "notion",
    label: "Notion",
    menuLabel: "Notion",
    icon: NotionLogo,
    prefix: "sources/notion/",
  },
  github: {
    type: "github",
    label: "GitHub",
    menuLabel: "GitHub",
    icon: GithubLogo,
    prefix: "sources/github/",
  },
};

export type ProviderGroup = {
  id: string;
  label: string;
  icon: SourceIcon;
  // Connector types grouped under this provider, in display order.
  types: ConnectorType[];
};

// Provider grouping drives the Knowledge sidebar sections and the
// add-source menus. Google fans out to three document types; Notion and
// GitHub each map to a single connector type.
export const PROVIDER_GROUPS: ProviderGroup[] = [
  { id: "google", label: "Google", icon: GoogleLogo, types: ["docs", "sheets", "slides"] },
  { id: "notion", label: "Notion", icon: NotionLogo, types: ["notion"] },
  { id: "github", label: "GitHub", icon: GithubLogo, types: ["github"] },
];

export function TypeIcon({
  type,
  className = "h-4 w-4 opacity-80",
}: {
  type: ConnectorType;
  className?: string;
}) {
  const Icon = SOURCE_TYPES[type]?.icon ?? Plug;
  return <Icon className={className} />;
}
