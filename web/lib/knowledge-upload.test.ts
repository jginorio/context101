import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_MARKDOWN_UPLOAD_BYTES,
  buildUploadKey,
  collectDroppedMarkdownFiles,
  describeUploadResult,
  fileBasename,
  filesFromDataTransfer,
  isExternalFileDrag,
  isMarkdownFilename,
  parentPrefixOfKey,
  sanitizeUploadName,
  uploadMarkdownFiles,
} from "./knowledge-upload";

test("isMarkdownFilename accepts .md and .markdown, any case", () => {
  assert.equal(isMarkdownFilename("notes.md"), true);
  assert.equal(isMarkdownFilename("NOTES.MD"), true);
  assert.equal(isMarkdownFilename("guide.markdown"), true);
  assert.equal(isMarkdownFilename("notes.txt"), false);
  assert.equal(isMarkdownFilename("notes.md.bak"), false);
});

test("fileBasename strips directory prefixes", () => {
  assert.equal(fileBasename("notes.md"), "notes.md");
  assert.equal(fileBasename("docs/notes.md"), "notes.md");
  assert.equal(fileBasename("docs\\notes.md"), "notes.md");
});

test("parentPrefixOfKey returns the folder prefix", () => {
  assert.equal(parentPrefixOfKey("notes.md"), "");
  assert.equal(parentPrefixOfKey("analytics/a.md"), "analytics/");
  assert.equal(parentPrefixOfKey("a/b/c.md"), "a/b/");
});

test("sanitizeUploadName keeps markdown basenames and rejects junk", () => {
  assert.equal(sanitizeUploadName("notes.md"), "notes.md");
  assert.equal(sanitizeUploadName("folder/notes.md"), "notes.md");
  assert.equal(sanitizeUploadName(".keep"), null);
  assert.equal(sanitizeUploadName(".."), null);
  assert.equal(sanitizeUploadName("notes.txt"), null);
  assert.equal(sanitizeUploadName(""), null);
});

test("buildUploadKey joins a folder prefix with the basename", () => {
  assert.equal(buildUploadKey("", "notes.md"), "notes.md");
  assert.equal(buildUploadKey("analytics/", "notes.md"), "analytics/notes.md");
  assert.equal(buildUploadKey("analytics/", "sub/notes.md"), "analytics/notes.md");
  assert.equal(buildUploadKey("../", "notes.md"), null);
  assert.equal(buildUploadKey("", "notes.txt"), null);
});

test("collectDroppedMarkdownFiles accepts multiple markdown files", () => {
  const files = [
    new File(["# one"], "one.md", { type: "text/markdown" }),
    new File(["# two"], "two.markdown", { type: "text/markdown" }),
    new File(["nope"], "photo.png", { type: "image/png" }),
  ];
  const decision = collectDroppedMarkdownFiles(files);
  assert.equal(decision.accepted.length, 2);
  assert.deepEqual(
    decision.accepted.map((file) => file.name),
    ["one.md", "two.markdown"]
  );
  assert.deepEqual(decision.skipped, [
    { name: "photo.png", reason: "not-markdown" },
  ]);
});

test("collectDroppedMarkdownFiles skips oversized and duplicate names", () => {
  const huge = new File(["x"], "huge.md", { type: "text/markdown" });
  Object.defineProperty(huge, "size", { value: MAX_MARKDOWN_UPLOAD_BYTES + 1 });
  const files = [
    new File(["a"], "Notes.md", { type: "text/markdown" }),
    new File(["b"], "notes.md", { type: "text/markdown" }),
    huge,
  ];
  const decision = collectDroppedMarkdownFiles(files);
  assert.equal(decision.accepted.length, 1);
  assert.equal(decision.accepted[0]?.name, "Notes.md");
  assert.deepEqual(decision.skipped, [
    { name: "huge.md", reason: "too-large" },
  ]);
});

test("isExternalFileDrag is true only for OS file drags", () => {
  assert.equal(isExternalFileDrag(["Files"]), true);
  assert.equal(isExternalFileDrag(["text/plain"]), false);
  assert.equal(isExternalFileDrag([]), false);
});

test("filesFromDataTransfer falls back to the FileList", async () => {
  const files = [new File(["# one"], "a.md", { type: "text/markdown" })];
  const result = await filesFromDataTransfer({
    items: { length: 0 } as DataTransferItemList,
    files: files as unknown as FileList,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.name, "a.md");
});

test("uploadMarkdownFiles puts accepted files under the folder prefix", async () => {
  const puts: { key: string; content: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    puts.push({ key: body.key, content: body.content });
    return new Response(JSON.stringify({ ok: true, key: body.key }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await uploadMarkdownFiles("analytics/", [
      new File(["# one"], "one.md", { type: "text/markdown" }),
      new File(["# two"], "two.md", { type: "text/markdown" }),
      new File(["nope"], "skip.txt", { type: "text/plain" }),
    ]);
    assert.deepEqual(result.uploaded.sort(), [
      "analytics/one.md",
      "analytics/two.md",
    ]);
    assert.equal(result.failed.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.deepEqual(
      puts.map((p) => p.key).sort(),
      ["analytics/one.md", "analytics/two.md"]
    );
    assert.equal(
      puts.find((p) => p.key === "analytics/one.md")?.content,
      "# one"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("describeUploadResult summarizes mixed outcomes", () => {
  assert.equal(
    describeUploadResult({
      uploaded: ["analytics/a.md"],
      skipped: [],
      failed: [],
    }).message,
    "Uploaded a.md."
  );
  assert.equal(
    describeUploadResult({
      uploaded: ["a.md", "b.md"],
      skipped: [{ name: "x.png", reason: "not-markdown" }],
      failed: [],
    }).message,
    "Uploaded 2 files. Skipped 1 non-markdown or invalid file."
  );
  assert.equal(
    describeUploadResult({
      uploaded: [],
      skipped: [{ name: "x.png", reason: "not-markdown" }],
      failed: [],
    }).message,
    "Drop .md or .markdown files."
  );
});
