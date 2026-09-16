/**
 * v0 connector contract — types only.
 *
 * Implementations stay in the per-type sync Lambdas
 * (`cdk/lambda/connector-sync-*`) and `cdk/lambda/connector-dispatch`.
 * Shipping surface is sources + retrieve. Wiki / Conflicts are parked.
 */

export const CONNECTOR_TYPES = [
  "docs",
  "sheets",
  "slides",
  "notion",
  "github",
] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** Picker kinds. `files` is a local markdown upload, not a connector row. */
export const ADD_SOURCE_KINDS = [...CONNECTOR_TYPES, "files"] as const;
export type AddSourceKind = (typeof ADD_SOURCE_KINDS)[number];

export const SOURCE_PREFIXES = {
  docs: "sources/docs/",
  sheets: "sources/sheets/",
  slides: "sources/slides/",
  notion: "sources/notion/",
  github: "sources/github/",
} as const satisfies Record<ConnectorType, `sources/${ConnectorType}/`>;

export type SourcePrefix = (typeof SOURCE_PREFIXES)[ConnectorType];

export type ConnectorAuthKind =
  | "google_oauth_refresh_token"
  | "notion_oauth_access_token"
  | "github_app"
  | "github_pat";

/** Client-facing status. `connecting` is transient UI and is never persisted. */
export type ConnectorStatus =
  | "pending_auth"
  | "connecting"
  | "syncing"
  | "connected"
  | "error"
  | "paused";

export type PersistedConnectorStatus = Exclude<ConnectorStatus, "connecting">;

/** Dispatcher / create-route invoke payload. Registry: FN_BY_TYPE. */
export type ConnectorSyncInput = {
  connectorId: string;
  docsBucket: string;
  brainId: string;
};

export type ConnectorSyncResult = {
  ok: true;
  itemCount?: number;
};

export type ConnectorS3MetadataAttributes = {
  source: ConnectorType;
  connector_id: string;
  last_synced?: string;
  [key: string]: string | undefined;
};

export type ConnectorS3Object = {
  key: string;
  sidecarKey: `${string}.metadata.json`;
  metadataAttributes: ConnectorS3MetadataAttributes;
};

export type ConnectorAuthNotes = {
  kind: ConnectorAuthKind | ConnectorAuthKind[];
  instanceSecret: string;
  perConnectorSecret: string;
  notes: string;
};

export const CONNECTOR_AUTH: Record<ConnectorType, ConnectorAuthNotes> = {
  docs: {
    kind: "google_oauth_refresh_token",
    instanceSecret: "GOOGLE_OAUTH_CLIENT_SECRET_ID → { client_id, client_secret }",
    perConnectorSecret: "{ refresh_token, … }",
    notes: "Google OAuth. Sync refreshes an access_token from refresh_token.",
  },
  sheets: {
    kind: "google_oauth_refresh_token",
    instanceSecret: "GOOGLE_OAUTH_CLIENT_SECRET_ID → { client_id, client_secret }",
    perConnectorSecret: "{ refresh_token, … }",
    notes: "Google OAuth. Same instance client as docs/slides.",
  },
  slides: {
    kind: "google_oauth_refresh_token",
    instanceSecret: "GOOGLE_OAUTH_CLIENT_SECRET_ID → { client_id, client_secret }",
    perConnectorSecret: "{ refresh_token, … }",
    notes: "Google OAuth. Same instance client as docs/sheets.",
  },
  notion: {
    kind: "notion_oauth_access_token",
    instanceSecret: "NOTION_OAUTH_CLIENT_SECRET_ID → { client_id, client_secret }",
    perConnectorSecret: "{ access_token, workspace_id, workspace_name, bot_id }",
    notes: "Notion public-integration OAuth. Long-lived access_token; no refresh.",
  },
  github: {
    kind: ["github_app", "github_pat"],
    instanceSecret:
      "GitHub App at <CONNECTOR_TOKEN_SECRET_PREFIX>github-app (app_id, client_id, client_secret, private_key). PAT is not instance-level.",
    perConnectorSecret:
      "App: metadata.auth=github-app + installation id. PAT: { github_pat } on the row secret.",
    notes: "App is preferred. PAT is the fallback when this instance has no GitHub App.",
  },
};

export const CONNECTOR_S3_LAYOUT: Record<
  ConnectorType,
  { prefix: SourcePrefix; objects: string; prune: string }
> = {
  docs: {
    prefix: SOURCE_PREFIXES.docs,
    objects: "sources/docs/<doc-slug>/content.md + sidecar",
    prune: "per-resource prefix; wholesale delete on remove is safe",
  },
  sheets: {
    prefix: SOURCE_PREFIXES.sheets,
    objects: "sources/sheets/<spreadsheet-slug>/<tab-slug>.md + sidecar",
    prune: "per-resource prefix; wholesale delete on remove is safe",
  },
  slides: {
    prefix: SOURCE_PREFIXES.slides,
    objects: "sources/slides/<deck-slug>/content.md + sidecar",
    prune: "per-resource prefix; wholesale delete on remove is safe",
  },
  notion: {
    prefix: SOURCE_PREFIXES.notion,
    objects: "sources/notion/<workspace-slug>/<page-slug>.md + sidecar",
    prune: "shared workspace prefix — delete only sidecars with this connector_id",
  },
  github: {
    prefix: SOURCE_PREFIXES.github,
    objects: "sources/github/<owner>-<repo>/<path>.md + sidecar",
    prune: "shared repo prefix — prune/delete only keys this connector owns (scope + connector_id)",
  },
};

export const MATRIX_ROWS = ["happy", "update", "delete", "bad-token"] as const;
export type ConnectorMatrixRow = (typeof MATRIX_ROWS)[number];

export type ConnectorMatrixCell = {
  type: ConnectorType;
  row: ConnectorMatrixRow;
  steps: string[];
  doneWhen: string;
};

const DONE_WHEN =
  "bin/retrieve --expect-key <s3-key> --canary <CANARY> matches; after delete, --absent-key and --absent-canary";

function googleHappy(type: ConnectorType): string[] {
  const prefix = SOURCE_PREFIXES[type];
  return [
    "Connect (OAuth) to a fixture doc that contains a unique canary. Do not use a shared-brain connector.",
    `Wait until ${prefix}<slug>/…md exists (bin/files list).`,
    "bin/retrieve --expect-key <key> --canary <CANARY> — same wait as library-ingest create.",
  ];
}

export function connectorMatrix(): ConnectorMatrixCell[] {
  const cells: ConnectorMatrixCell[] = [];
  for (const type of CONNECTOR_TYPES) {
    cells.push({
      type,
      row: "happy",
      steps:
        type === "github"
          ? githubHappyPathSteps().map((step) => step.action)
          : googleHappy(type),
      doneWhen: DONE_WHEN,
    });
    cells.push({
      type,
      row: "update",
      steps: [
        "Change the upstream document (new canary). Sync now.",
        "bin/retrieve --expect-key <same-or-new-key> --canary <NEW> — remap, like library-ingest rename.",
      ],
      doneWhen: DONE_WHEN,
    });
    cells.push({
      type,
      row: "delete",
      steps: [
        "Remove the connector (Sources card). S3 objects this connector owns are deleted (not a wiki tombstone).",
        "bin/retrieve --absent-key <key> --absent-canary <CANARY> — same wait as library-ingest delete.",
      ],
      doneWhen: "bin/retrieve --absent-key and --absent-canary both hold",
    });
    cells.push({
      type,
      row: "bad-token",
      steps: [
        "Use an invalid / revoked token (do not print it).",
        "Sources card is ERROR. Accordion trigger is the one-line summary; panel is last_error.",
        "No new S3 keys. Retrieve still misses the canary.",
      ],
      doneWhen: "status=error; retrieve does not rank a new key for this connector",
    });
  }
  return cells;
}

export type ConnectorMatrixStep = {
  id: string;
  action: string;
  proof: string;
};

/**
 * First concrete matrix row. Library-ingest is the template:
 * put → retrieve canary, change → remap, delete → absent.
 * GitHub is the live fixture: a test-repo .md + PAT/App, no OAuth browser.
 */
export function githubHappyPathSteps(): ConnectorMatrixStep[] {
  return [
    {
      id: "connect",
      action:
        "Add a GitHub connector to a fixture repo (PAT or App). The synced .md contains a unique canary. Dedicated verify brain only.",
      proof: "connector row status=connected or syncing; never print the PAT",
    },
    {
      id: "s3",
      action:
        "Wait until sources/github/<owner>-<repo>/<path>.md is listed (bin/files list).",
      proof: "list JSON includes the key under sources/github/",
    },
    {
      id: "retrieve-create",
      action:
        'bin/retrieve --expect-key "sources/github/<slug>/<path>.md" --canary "<CANARY>" --timeout 480 "<query including CANARY>"',
      proof: 'retrieve JSON "ok": true and matched_expect contains the key (library-ingest create)',
    },
    {
      id: "update",
      action:
        "Change the fixture .md (new canary), Sync now. Wait until retrieve ranks the new canary.",
      proof: "retrieve --canary <NEW> --expect-key <key> (library-ingest remap)",
    },
    {
      id: "delete",
      action:
        "POST /api/connectors/delete for this connector. Wait until retrieve drops the key.",
      proof:
        "retrieve --absent-key <key> --absent-canary <CANARY> (library-ingest delete). Sibling GitHub connectors on the same repo stay.",
    },
  ];
}

export function s3PrefixFor(type: ConnectorType): SourcePrefix {
  return SOURCE_PREFIXES[type];
}

export function sidecarKeyFor(objectKey: string): `${string}.metadata.json` {
  return `${objectKey}.metadata.json`;
}

export function isConnectorType(value: unknown): value is ConnectorType {
  return (
    typeof value === "string" &&
    (CONNECTOR_TYPES as readonly string[]).includes(value)
  );
}

export function authKindsFor(type: ConnectorType): ConnectorAuthKind[] {
  const kind = CONNECTOR_AUTH[type].kind;
  return Array.isArray(kind) ? kind : [kind];
}

export function matrixCell(
  type: ConnectorType,
  row: ConnectorMatrixRow
): ConnectorMatrixCell {
  const cell = connectorMatrix().find((c) => c.type === type && c.row === row);
  if (!cell) throw new Error(`no matrix cell for ${type}/${row}`);
  return cell;
}
