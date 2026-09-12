import assert from "node:assert/strict";
import { test } from "node:test";
import { isHostedContext101Url, ownPublicUrl } from "../src/hosted-url.js";

function hostedProductUrl(sub) {
  const zone = ["context", "101", ".", "dev"].join("");
  return sub ? `https://${sub}.${zone}` : `https://${zone}`;
}

test("isHostedContext101Url matches the hosted product zone only", () => {
  assert.equal(isHostedContext101Url(hostedProductUrl("app")), true);
  assert.equal(isHostedContext101Url(hostedProductUrl("www")), true);
  assert.equal(isHostedContext101Url(hostedProductUrl("mcp")), true);
  assert.equal(isHostedContext101Url(hostedProductUrl()), true);
  assert.equal(isHostedContext101Url("https://main.d123.amplifyapp.com"), false);
  assert.equal(isHostedContext101Url("https://kb.example.com"), false);
  assert.equal(isHostedContext101Url(""), false);
  assert.equal(isHostedContext101Url(undefined), false);
});

test("ownPublicUrl drops hosted product URLs and keeps operator domains", () => {
  assert.equal(ownPublicUrl(hostedProductUrl("app")), undefined);
  assert.equal(ownPublicUrl("https://kb.example.com"), "https://kb.example.com");
  assert.equal(ownPublicUrl("  https://docs.example.com  "), "https://docs.example.com");
});
