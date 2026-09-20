import assert from "node:assert/strict";
import { test } from "node:test";

import { isConnectorType } from "./connectors/contract";
import {
  GOOGLE_DOC_MIME,
  GOOGLE_PICKER_MIME_TYPES,
  GOOGLE_PICKER_SCOPES,
  GOOGLE_SHEET_MIME,
  GOOGLE_SLIDE_MIME,
  googleFileFromPickerDoc,
  googleResourceUrl,
  googleTypeFromMime,
  googleTypeFromUrl,
  isGoogleConnectorType,
  oauthScopesForGooglePicker,
} from "./google-source";

test("google is an add-source kind, not a connector type", () => {
  assert.equal(isConnectorType("google"), false);
  assert.equal(isConnectorType("docs"), true);
  assert.equal(isGoogleConnectorType("docs"), true);
  assert.equal(isGoogleConnectorType("google"), false);
  assert.equal(isGoogleConnectorType("notion"), false);
});

test("mime maps onto docs | sheets | slides and rejects everything else", () => {
  assert.equal(googleTypeFromMime(GOOGLE_DOC_MIME), "docs");
  assert.equal(googleTypeFromMime(GOOGLE_SHEET_MIME), "sheets");
  assert.equal(googleTypeFromMime(GOOGLE_SLIDE_MIME), "slides");
  assert.equal(googleTypeFromMime("application/pdf"), null);
  assert.equal(googleTypeFromMime("application/vnd.google-apps.folder"), null);
  assert.equal(googleTypeFromMime(""), null);
  assert.equal(googleTypeFromMime(undefined), null);
  assert.deepEqual([...GOOGLE_PICKER_MIME_TYPES], [
    GOOGLE_DOC_MIME,
    GOOGLE_SHEET_MIME,
    GOOGLE_SLIDE_MIME,
  ]);
});

test("resource URLs parse back to the same type", () => {
  assert.equal(
    googleResourceUrl("docs", "Abc_12-xy"),
    "https://docs.google.com/document/d/Abc_12-xy/edit"
  );
  assert.equal(
    googleResourceUrl("sheets", "Abc_12-xy"),
    "https://docs.google.com/spreadsheets/d/Abc_12-xy/edit"
  );
  assert.equal(
    googleResourceUrl("slides", "Abc_12-xy"),
    "https://docs.google.com/presentation/d/Abc_12-xy/edit"
  );
  assert.equal(
    googleTypeFromUrl(googleResourceUrl("docs", "Abc_12-xy")),
    "docs"
  );
  assert.equal(
    googleTypeFromUrl(googleResourceUrl("sheets", "Abc_12-xy")),
    "sheets"
  );
  assert.equal(
    googleTypeFromUrl(googleResourceUrl("slides", "Abc_12-xy")),
    "slides"
  );
  assert.equal(googleTypeFromUrl("https://drive.google.com/file/d/x/view"), null);
  assert.equal(googleTypeFromUrl(""), null);
  // Same shapes `parseDocId` / `parseSheetId` / `parseSlidesId` accept.
  assert.match(
    googleResourceUrl("docs", "Abc_12-xy"),
    /\/document\/d\/Abc_12-xy/
  );
  assert.match(
    googleResourceUrl("sheets", "Abc_12-xy"),
    /\/spreadsheets\/d\/Abc_12-xy/
  );
  assert.match(
    googleResourceUrl("slides", "Abc_12-xy"),
    /\/presentation\/d\/Abc_12-xy/
  );
});

test("picker docs become connector payloads; folders and missing ids drop", () => {
  assert.deepEqual(
    googleFileFromPickerDoc({
      id: "Abc_12-xy",
      name: "Q2 strategy memo",
      mimeType: GOOGLE_DOC_MIME,
    }),
    {
      type: "docs",
      id: "Abc_12-xy",
      url: "https://docs.google.com/document/d/Abc_12-xy/edit",
      name: "Q2 strategy memo",
    }
  );
  assert.equal(
    googleFileFromPickerDoc({
      id: "folder-1",
      name: "Team",
      mimeType: "application/vnd.google-apps.folder",
    }),
    null
  );
  assert.equal(
    googleFileFromPickerDoc({
      name: "no id",
      mimeType: GOOGLE_SHEET_MIME,
    }),
    null
  );
});

test("picker scopes include drive.file plus the three readonly Workspace APIs", () => {
  const scopes = oauthScopesForGooglePicker();
  assert.ok(scopes.includes("https://www.googleapis.com/auth/drive.file"));
  assert.ok(scopes.includes("https://www.googleapis.com/auth/documents.readonly"));
  assert.ok(
    scopes.includes("https://www.googleapis.com/auth/spreadsheets.readonly")
  );
  assert.ok(
    scopes.includes("https://www.googleapis.com/auth/presentations.readonly")
  );
  assert.equal(scopes.includes("https://www.googleapis.com/auth/drive"), false);
  assert.equal(
    scopes.includes("https://www.googleapis.com/auth/drive.readonly"),
    false
  );
  assert.deepEqual(scopes, [...GOOGLE_PICKER_SCOPES]);
});
