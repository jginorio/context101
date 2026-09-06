import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configuredPublicOriginFrom,
  resolvePublicOrigin,
} from "./public-origin";

function headers(init: Record<string, string>): {
  get(name: string): string | null;
} {
  const normalized = Object.fromEntries(
    Object.entries(init).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    get(name: string) {
      return normalized[name.toLowerCase()] ?? null;
    },
  };
}

test("configuredPublicOrigin ignores localhost APP_URL and BETTER_AUTH_URL", () => {
  assert.equal(
    configuredPublicOriginFrom("http://localhost:3000", "http://localhost:3000"),
    null
  );
  assert.equal(
    configuredPublicOriginFrom(
      "https://app.example.test",
      "http://localhost:3000"
    ),
    "https://app.example.test"
  );
  assert.equal(
    configuredPublicOriginFrom(undefined, "https://app.example.test/"),
    "https://app.example.test"
  );
});

test("uses x-forwarded-host when Amplify reports a public host", () => {
  assert.equal(
    resolvePublicOrigin(
      headers({
        "x-forwarded-host": "app.example.test",
        "x-forwarded-proto": "https",
      }),
      "https://localhost:3000",
      null
    ),
    "https://app.example.test"
  );
});

test("replaces Amplify localhost with the configured public origin", () => {
  assert.equal(
    resolvePublicOrigin(
      headers({
        host: "localhost:3000",
        "x-forwarded-host": "localhost:3000",
        "x-forwarded-proto": "https",
      }),
      "https://localhost:3000",
      "https://app.example.test"
    ),
    "https://app.example.test"
  );
});

test("keeps localhost in local dev when no public origin is configured", () => {
  assert.equal(
    resolvePublicOrigin(
      headers({ host: "localhost:3000" }),
      "http://localhost:3000",
      null
    ),
    "http://localhost:3000"
  );
});

test("takes the first x-forwarded-host when proxies send a list", () => {
  assert.equal(
    resolvePublicOrigin(
      headers({
        "x-forwarded-host": "app.example.test, localhost:3000",
        "x-forwarded-proto": "https",
      }),
      "https://localhost:3000",
      null
    ),
    "https://app.example.test"
  );
});
