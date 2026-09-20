import type { ConnectorType } from "@/lib/connectors/contract";

/** Google Workspace MIME types the Drive picker may return. */
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDE_MIME = "application/vnd.google-apps.presentation";

export const GOOGLE_PICKER_MIME_TYPES = [
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  GOOGLE_SLIDE_MIME,
] as const;

export type GoogleConnectorType = Extract<
  ConnectorType,
  "docs" | "sheets" | "slides"
>;

export const GOOGLE_CONNECTOR_TYPES = [
  "docs",
  "sheets",
  "slides",
] as const satisfies readonly GoogleConnectorType[];

export function isGoogleConnectorType(
  value: string | null | undefined
): value is GoogleConnectorType {
  return (
    value === "docs" || value === "sheets" || value === "slides"
  );
}

const MIME_TO_TYPE: Record<string, GoogleConnectorType> = {
  [GOOGLE_DOC_MIME]: "docs",
  [GOOGLE_SHEET_MIME]: "sheets",
  [GOOGLE_SLIDE_MIME]: "slides",
};

/**
 * Map a Google Drive / Picker MIME type onto the existing connector
 * `source_type` enum. Unknown MIME types (folders, PDFs, …) return null —
 * we do not invent a `drive` row.
 */
export function googleTypeFromMime(
  mimeType: string | null | undefined
): GoogleConnectorType | null {
  if (!mimeType) return null;
  return MIME_TO_TYPE[mimeType] ?? null;
}

export function googleResourceUrl(
  type: GoogleConnectorType,
  id: string
): string {
  const safeId = id.trim();
  switch (type) {
    case "docs":
      return `https://docs.google.com/document/d/${safeId}/edit`;
    case "sheets":
      return `https://docs.google.com/spreadsheets/d/${safeId}/edit`;
    case "slides":
      return `https://docs.google.com/presentation/d/${safeId}/edit`;
  }
}

/** Infer docs | sheets | slides from a pasted docs.google.com URL. */
export function googleTypeFromUrl(
  url: string | null | undefined
): GoogleConnectorType | null {
  if (!url) return null;
  if (/\/document\/d\//.test(url)) return "docs";
  if (/\/spreadsheets\/d\//.test(url)) return "sheets";
  if (/\/presentation\/d\//.test(url)) return "slides";
  return null;
}

export type GooglePickerDoc = {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
};

export type PickedGoogleFile = {
  type: GoogleConnectorType;
  id: string;
  url: string;
  name: string;
};

/**
 * Turn a Google Picker Document into a connector payload. Rejects
 * anything that is not a Doc / Sheet / Slide.
 */
export function googleFileFromPickerDoc(
  doc: GooglePickerDoc | null | undefined
): PickedGoogleFile | null {
  if (!doc) return null;
  const id = typeof doc.id === "string" ? doc.id.trim() : "";
  const type = googleTypeFromMime(doc.mimeType);
  if (!id || !type) return null;
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  return {
    type,
    id,
    url: googleResourceUrl(type, id),
    name,
  };
}

/** Least privilege that makes Picker work: files the user opens with us. */
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

/**
 * Scopes for the unified Google connect + Picker session.
 *
 * `drive.file` is required for Picker to grant access to the chosen file.
 * The three readonly Workspace APIs are what the existing sync Lambdas
 * use after create. Identity scopes match today's per-type consent.
 *
 * Consent-screen impact vs today's per-type Connect: the first Google
 * connect asks for Docs + Sheets + Slides + Drive files opened with this
 * app, not just one Workspace product. Paste-URL without a picker session
 * still uses the narrower per-type scopes.
 */
export const GOOGLE_PICKER_SCOPES = [
  GOOGLE_DRIVE_FILE_SCOPE,
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/presentations.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "openid",
  "email",
  "profile",
] as const;

export function oauthScopesForGooglePicker(): string[] {
  return [...GOOGLE_PICKER_SCOPES];
}
