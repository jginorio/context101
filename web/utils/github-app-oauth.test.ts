import assert from "node:assert/strict";
import { test } from "node:test";

import {
  githubOauthRedirectUri,
  githubOauthUrl,
  userInstallationAccessApiPath,
} from "./github-app";

test("OAuth redirect URI is the public callback, not localhost-relative", () => {
  assert.equal(
    githubOauthRedirectUri("https://app.example.test"),
    "https://app.example.test/api/connectors/github-app/oauth-callback"
  );
  assert.equal(
    githubOauthRedirectUri("https://app.example.test/"),
    "https://app.example.test/api/connectors/github-app/oauth-callback"
  );
});

test("authorize URL includes the same redirect_uri the token exchange must send", () => {
  const url = new URL(
    githubOauthUrl(
      { client_id: "Iv1.test" },
      "https://app.example.test",
      "signed-state"
    )
  );
  assert.equal(url.origin, "https://github.com");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://app.example.test/api/connectors/github-app/oauth-callback"
  );
  assert.equal(url.searchParams.get("state"), "signed-state");
});

test("installation access uses the documented repositories endpoint", () => {
  const path = userInstallationAccessApiPath("123456");
  assert.equal(
    path,
    "/user/installations/123456/repositories?per_page=1"
  );
  assert.doesNotMatch(path, /\/user\/installations\/123456$/);
});
