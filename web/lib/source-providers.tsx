import type { ComponentType } from "react";
import { FileUp, Plug } from "lucide-react";

import {
  GithubLogo,
  GoogleDocsLogo,
  GoogleLogo,
  GoogleSheetsLogo,
  GoogleSlidesLogo,
  NotionLogo,
} from "@/components/source-logos";
import {
  CONNECTOR_TYPES,
  SOURCE_PREFIXES,
  type AddSourceKind,
  type ConnectorType,
} from "@/lib/connectors/contract";
import {
  isGoogleConnectorType,
  type GoogleConnectorType,
} from "@/lib/google-source";

export { CONNECTOR_TYPES, type AddSourceKind, type ConnectorType };
export { isGoogleConnectorType, type GoogleConnectorType };

// Any component that accepts a className — covers both the brand SVG marks
// and Lucide icons.
export type SourceIcon = ComponentType<{ className?: string }>;

// Connector types that surface in the UI. Mirrors the Postgres `source_type`
// enum minus `manual` (manual files are uploaded through Add source, not a
// connector row). Canonical types: `@/lib/connectors/contract`.

export const FILES_SOURCE = {
  kind: "files" as const,
  menuLabel: "Upload files",
  icon: FileUp,
};

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
    prefix: SOURCE_PREFIXES.docs,
  },
  sheets: {
    type: "sheets",
    label: "Sheets",
    menuLabel: "Google Sheets",
    icon: GoogleSheetsLogo,
    prefix: SOURCE_PREFIXES.sheets,
  },
  slides: {
    type: "slides",
    label: "Slides",
    menuLabel: "Google Slides",
    icon: GoogleSlidesLogo,
    prefix: SOURCE_PREFIXES.slides,
  },
  notion: {
    type: "notion",
    label: "Notion",
    menuLabel: "Notion",
    icon: NotionLogo,
    prefix: SOURCE_PREFIXES.notion,
  },
  github: {
    type: "github",
    label: "GitHub",
    menuLabel: "GitHub",
    icon: GithubLogo,
    prefix: SOURCE_PREFIXES.github,
  },
};

export type ProviderGroup = {
  id: string;
  label: string;
  icon: SourceIcon;
  // Connector types grouped under this provider, in display order.
  types: ConnectorType[];
};

// Provider grouping drives the Knowledge sidebar sections (Google still
// fans out to Docs / Sheets / Slides for synced trees). The add-source
// menu uses ADD_SOURCE_MENU — one Google row, not three URL forms.
export const PROVIDER_GROUPS: ProviderGroup[] = [
  { id: "google", label: "Google", icon: GoogleLogo, types: ["docs", "sheets", "slides"] },
  { id: "notion", label: "Notion", icon: NotionLogo, types: ["notion"] },
  { id: "github", label: "GitHub", icon: GithubLogo, types: ["github"] },
];

export const GOOGLE_SOURCE = {
  kind: "google" as const,
  menuLabel: "Google",
  icon: GoogleLogo,
};

export function isGoogleAddKind(
  kind: AddSourceKind | null | undefined
): kind is "google" | GoogleConnectorType {
  return kind === "google" || isGoogleConnectorType(kind);
}

/** Rows in the Add source picker and the Sources “Add a source” panel. */
export const ADD_SOURCE_MENU: {
  kind: AddSourceKind;
  menuLabel: string;
  icon: SourceIcon;
}[] = [
  FILES_SOURCE,
  GOOGLE_SOURCE,
  {
    kind: "notion",
    menuLabel: SOURCE_TYPES.notion.menuLabel,
    icon: SOURCE_TYPES.notion.icon,
  },
  {
    kind: "github",
    menuLabel: SOURCE_TYPES.github.menuLabel,
    icon: SOURCE_TYPES.github.icon,
  },
];

// Flat connector order for the knowledge sidebar (Google types first, then
// single-provider connectors). `CONNECTOR_TYPES` is re-exported from the
// contract module.

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
