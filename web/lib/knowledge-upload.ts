/**
 * Helpers for dragging markdown files from the OS into the Knowledge
 * library. Keys are `{parentPrefix}{basename}` — e.g. dropping
 * `notes.md` on `analytics/` writes `analytics/notes.md`.
 */

export const MAX_MARKDOWN_UPLOAD_BYTES = 5 * 1024 * 1024;

export type SkippedUpload = {
  name: string;
  reason: "not-markdown" | "too-large" | "invalid-name";
};

export type UploadDecision = {
  accepted: File[];
  skipped: SkippedUpload[];
};

export function isMarkdownFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

export function fileBasename(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? name;
}

export function parentPrefixOfKey(key: string): string {
  const idx = key.lastIndexOf("/");
  return idx >= 0 ? key.slice(0, idx + 1) : "";
}

export function sanitizeUploadName(name: string): string | null {
  const base = fileBasename(name).trim();
  if (!base) return null;
  if (base === "." || base === "..") return null;
  if (base.startsWith(".")) return null;
  if (base.includes("..")) return null;
  if (!isMarkdownFilename(base)) return null;
  return base;
}

export function buildUploadKey(
  parentPrefix: string,
  filename: string
): string | null {
  const name = sanitizeUploadName(filename);
  if (!name) return null;
  if (parentPrefix.startsWith("/") || parentPrefix.includes("..")) return null;
  return `${parentPrefix}${name}`;
}

export function collectDroppedMarkdownFiles(
  files: Iterable<File>
): UploadDecision {
  const accepted: File[] = [];
  const skipped: SkippedUpload[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const name = sanitizeUploadName(file.name);
    if (!name) {
      skipped.push({
        name: file.name || "(unnamed)",
        reason: isMarkdownFilename(file.name) ? "invalid-name" : "not-markdown",
      });
      continue;
    }
    if (file.size > MAX_MARKDOWN_UPLOAD_BYTES) {
      skipped.push({ name: file.name, reason: "too-large" });
      continue;
    }
    const dedupe = name.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    accepted.push(file);
  }

  return { accepted, skipped };
}

export function isExternalFileDrag(types: readonly string[]): boolean {
  return types.includes("Files");
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  file?: (
    successCallback: (file: File) => void,
    errorCallback?: (err: DOMException) => void
  ) => void;
  createReader?: () => {
    readEntries: (
      successCallback: (entries: FileSystemEntryLike[]) => void,
      errorCallback?: (err: DOMException) => void
    ) => void;
  };
};

function readAllDirectoryEntries(
  reader: NonNullable<FileSystemEntryLike["createReader"]> extends () => infer R
    ? R
    : never
): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntryLike[] = [];
    const readBatch = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            resolve(all);
            return;
          }
          all.push(...entries);
          readBatch();
        },
        () => resolve(all)
      );
    };
    readBatch();
  });
}

async function walkEntry(
  entry: FileSystemEntryLike,
  out: File[]
): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => {
      entry.file!(resolve, () => resolve(null));
    });
    if (file) out.push(file);
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readAllDirectoryEntries(entry.createReader());
    await Promise.all(children.map((child) => walkEntry(child, out)));
  }
}

/**
 * Collect File objects from a drop. Walks dropped folders (Chrome
 * `webkitGetAsEntry`) so a directory of `.md` files counts as multiple
 * uploads. Falls back to `dataTransfer.files`.
 */
export async function filesFromDataTransfer(
  dt: Pick<DataTransfer, "items" | "files">
): Promise<File[]> {
  const items = dt.items;
  if (items && items.length > 0) {
    const collected: File[] = [];
    const walks: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const entry =
        typeof item.webkitGetAsEntry === "function"
          ? (item.webkitGetAsEntry() as FileSystemEntryLike | null)
          : null;
      if (entry) {
        walks.push(walkEntry(entry, collected));
      } else {
        const file = item.getAsFile();
        if (file) collected.push(file);
      }
    }

    await Promise.all(walks);
    if (collected.length > 0) return collected;
  }

  return Array.from(dt.files);
}

export async function putMarkdownFile(
  key: string,
  content: string
): Promise<string> {
  const res = await fetch("/api/files/put", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, content, contentType: "text/markdown" }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `upload failed: ${key}`);
  }
  return key;
}

export type UploadResult = {
  uploaded: string[];
  skipped: SkippedUpload[];
  failed: { name: string; error: string }[];
};

export async function uploadMarkdownFiles(
  parentPrefix: string,
  files: File[]
): Promise<UploadResult> {
  const { accepted, skipped } = collectDroppedMarkdownFiles(files);
  const uploaded: string[] = [];
  const failed: { name: string; error: string }[] = [];

  await Promise.all(
    accepted.map(async (file) => {
      const key = buildUploadKey(parentPrefix, file.name);
      if (!key) {
        failed.push({ name: file.name, error: "invalid name" });
        return;
      }
      try {
        const content = await file.text();
        await putMarkdownFile(key, content);
        uploaded.push(key);
      } catch (error) {
        failed.push({
          name: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );

  return { uploaded, skipped, failed };
}

export function describeUploadResult(result: UploadResult): {
  tone: "success" | "error" | "info";
  message: string;
} {
  const { uploaded, skipped, failed } = result;
  const skippedNote =
    skipped.length === 0
      ? ""
      : ` Skipped ${skipped.length} non-markdown or invalid file${skipped.length === 1 ? "" : "s"}.`;

  if (uploaded.length === 0 && failed.length === 0) {
    return {
      tone: skipped.some((s) => s.reason === "too-large") ? "error" : "info",
      message: skipped.some((s) => s.reason === "too-large")
        ? "Some files are larger than 5 MB."
        : "Drop .md or .markdown files.",
    };
  }

  if (failed.length > 0 && uploaded.length === 0) {
    return {
      tone: "error",
      message: failed[0]?.error ?? "Upload failed",
    };
  }

  if (failed.length > 0) {
    return {
      tone: "error",
      message: `Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}; ${failed.length} failed.${skippedNote}`,
    };
  }

  const firstName = fileBasename(uploaded[0] ?? "");
  const success =
    uploaded.length === 1
      ? `Uploaded ${firstName}.`
      : `Uploaded ${uploaded.length} files.`;
  return {
    tone: "success",
    message: `${success}${skippedNote}`,
  };
}
