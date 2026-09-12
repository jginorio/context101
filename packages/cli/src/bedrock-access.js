/**
 * Request Bedrock model access for every embedding model we support.
 * Amazon first-party models are auto-enabled. Cohere (Marketplace) needs
 * a foundation-model agreement. Never print offer tokens.
 */

export function parseAvailability(payload) {
  const status = payload?.agreementAvailability?.status;
  const entitlement = payload?.entitlementAvailability;
  return {
    available: status === "AVAILABLE" || entitlement === "AVAILABLE",
    status: status || entitlement || "unknown",
  };
}

export function pickOfferToken(payload) {
  const offers = Array.isArray(payload?.offers) ? payload.offers : [];
  const pub = offers.find((offer) => offer.offerType === "PUBLIC") || offers[0];
  return pub?.offerToken ? String(pub.offerToken) : "";
}

function awsJson(exec, env, args) {
  const result = exec({
    command: "aws",
    args,
    env,
  });
  if (!result.ok) {
    return { ok: false, error: result.stderr || result.stdout || "aws failed", data: null };
  }
  try {
    return { ok: true, error: null, data: JSON.parse(result.stdout || "{}") };
  } catch {
    return { ok: false, error: "could not parse aws json", data: null };
  }
}

export function requestEmbeddingModelAccess({
  exec,
  env,
  region,
  models,
  dryRun = false,
} = {}) {
  const results = [];
  for (const model of models || []) {
    if (dryRun) {
      results.push({ id: model.id, status: "would-request" });
      continue;
    }
    if (model.provider === "aws") {
      results.push({ id: model.id, status: "first-party" });
      continue;
    }

    const availability = awsJson(exec, env, [
      "bedrock",
      "get-foundation-model-availability",
      "--model-id",
      model.id,
      "--region",
      region,
      "--output",
      "json",
    ]);
    if (availability.ok && parseAvailability(availability.data).available) {
      results.push({ id: model.id, status: "already-available" });
      continue;
    }

    const offers = awsJson(exec, env, [
      "bedrock",
      "list-foundation-model-agreement-offers",
      "--model-id",
      model.id,
      "--region",
      region,
      "--output",
      "json",
    ]);
    const token = offers.ok ? pickOfferToken(offers.data) : "";
    if (!token) {
      results.push({
        id: model.id,
        status: "needs-console",
        detail: "no Marketplace offer (enable in console → Model access)",
      });
      continue;
    }

    const created = exec({
      command: "aws",
      args: [
        "bedrock",
        "create-foundation-model-agreement",
        "--model-id",
        model.id,
        "--offer-token",
        token,
        "--region",
        region,
      ],
      env,
    });
    if (created.ok) {
      results.push({ id: model.id, status: "granted" });
      continue;
    }
    const err = `${created.stderr || created.stdout || ""}`;
    if (/already|exist|Conflict/i.test(err)) {
      results.push({ id: model.id, status: "already-available" });
      continue;
    }
    results.push({
      id: model.id,
      status: "needs-console",
      detail: "could not create agreement — enable in console → Model access",
    });
  }
  return results;
}

export function formatAccessResult(result) {
  if (result.status === "first-party") return `${result.id}  Amazon (auto-enabled)`;
  if (result.status === "already-available") return `${result.id}  already available`;
  if (result.status === "granted") return `${result.id}  access granted`;
  if (result.status === "would-request") return `${result.id}  would request`;
  return `${result.id}  ${result.detail || "enable in console → Model access"}`;
}
