import assert from "node:assert/strict";
import { test } from "node:test";

import { isHostedDeployment, resolveAppMode } from "./config";

test("only APP_MODE=hosted is the Hosted product", () => {
  assert.equal(resolveAppMode({ APP_MODE: "hosted" }), "hosted");
  assert.equal(isHostedDeployment({ APP_MODE: "hosted" }), true);
});

test("self-host is the default and any non-hosted APP_MODE", () => {
  assert.equal(resolveAppMode({}), "self_hosted");
  assert.equal(resolveAppMode({ APP_MODE: "" }), "self_hosted");
  assert.equal(resolveAppMode({ APP_MODE: "self_hosted" }), "self_hosted");
  assert.equal(resolveAppMode({ APP_MODE: "HOSTED" }), "self_hosted");
  assert.equal(resolveAppMode({ APP_MODE: "prod" }), "self_hosted");
  assert.equal(isHostedDeployment({}), false);
  assert.equal(isHostedDeployment({ APP_MODE: "self_hosted" }), false);
});

test("billing, signup, and APP_URL do not mark a space as Hosted", () => {
  assert.equal(
    isHostedDeployment({
      BILLING_ENABLED: "true",
      ALLOW_PUBLIC_SIGNUP: "true",
      APP_URL: "https://kb.customer.example",
    }),
    false
  );
});
