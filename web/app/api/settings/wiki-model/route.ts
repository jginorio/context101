import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { readAuthContext } from "@/lib/brains-server";
import { db } from "@/lib/db/client";
import { brains } from "@/lib/db/schema";
import { member } from "@/lib/db/auth-schema";

const secrets = new SecretsManagerClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

const PROVIDERS = [
  "bedrock",
  "anthropic",
  "openai",
  "grok",
  "gemini",
  "claude-code",
] as const;
type Provider = (typeof PROVIDERS)[number];

// Providers that require an explicit model id. The subscription CLI agents
// (claude-code) default to the subscription's own model, so the id is optional.
const NEEDS_MODEL_ID: Provider[] = ["anthropic", "openai", "grok", "gemini"];

function keySecretName(brainId: string): string {
  return `context101-brain-${brainId}-llm-key`;
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "ResourceNotFoundException";
}

async function isPrivileged(userId: string, orgId: string): Promise<boolean> {
  if (!db) return false;
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return row?.role === "admin" || row?.role === "owner";
}

async function loadBrain(orgId: string, brainId: string) {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(brains)
    .where(and(eq(brains.orgId, orgId), eq(brains.id, brainId)))
    .limit(1);
  return row ?? null;
}

/**
 * GET /api/settings/wiki-model?brain=<id>
 * Returns the brain's wiki model config (never the raw key).
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const brainId = request.nextUrl.searchParams.get("brain");
  if (!brainId) {
    return NextResponse.json({ error: "brain is required" }, { status: 400 });
  }
  const brain = await loadBrain(auth.orgId, brainId);
  if (!brain) {
    return NextResponse.json({ error: "brain not found" }, { status: 404 });
  }
  return NextResponse.json({
    provider: (brain.wikiModelProvider ?? "bedrock") as Provider,
    model_id: brain.wikiModelId ?? null,
    has_key: !!brain.wikiLlmKeySecretArn,
  });
}

/**
 * POST /api/settings/wiki-model
 * Body: { brainId, provider, modelId?, apiKey? }
 *
 * Admin-only. For bring-your-own providers the API key is written to Secrets
 * Manager (context101-brain-<id>-llm-key); only the ARN is stored in Postgres.
 * Switching back to Bedrock clears the stored key.
 */
export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 500 }
    );
  }
  const auth = await readAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (!(await isPrivileged(auth.userId, auth.orgId))) {
    return NextResponse.json(
      { error: "only organization admins can change the wiki model" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const brainId = typeof body?.brainId === "string" ? body.brainId : "";
  const provider = body?.provider as Provider | undefined;
  const modelId =
    typeof body?.modelId === "string" ? body.modelId.trim() : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  if (!brainId) {
    return NextResponse.json({ error: "brainId is required" }, { status: 400 });
  }
  if (!provider || !PROVIDERS.includes(provider)) {
    return NextResponse.json(
      { error: `provider must be one of ${PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }

  const brain = await loadBrain(auth.orgId, brainId);
  if (!brain) {
    return NextResponse.json({ error: "brain not found" }, { status: 404 });
  }

  try {
    if (provider === "bedrock") {
      // Reset to the keyless Bedrock path; remove any stored BYO key.
      if (brain.wikiLlmKeySecretArn) {
        await secrets
          .send(
            new DeleteSecretCommand({
              SecretId: brain.wikiLlmKeySecretArn,
              ForceDeleteWithoutRecovery: true,
            })
          )
          .catch((e) => {
            if (!isNotFound(e)) throw e;
          });
      }
      await db
        .update(brains)
        .set({
          wikiModelProvider: "bedrock",
          wikiModelId: modelId || null,
          wikiLlmKeySecretArn: null,
          updatedAt: new Date(),
        })
        .where(and(eq(brains.orgId, auth.orgId), eq(brains.id, brainId)));
      return NextResponse.json({ ok: true });
    }

    // Bring-your-own / subscription provider. API-key providers require an
    // explicit model id; claude-code defers to the subscription default.
    if (NEEDS_MODEL_ID.includes(provider) && !modelId) {
      return NextResponse.json(
        { error: "modelId is required for this provider" },
        { status: 400 }
      );
    }

    let keyArn = brain.wikiLlmKeySecretArn ?? undefined;
    if (apiKey) {
      const name = keySecretName(brainId);
      // Upsert the secret value.
      let exists = !!keyArn;
      if (!exists) {
        try {
          await secrets.send(new DescribeSecretCommand({ SecretId: name }));
          exists = true;
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
      }
      if (exists) {
        await secrets.send(
          new PutSecretValueCommand({
            SecretId: keyArn ?? name,
            SecretString: apiKey,
          })
        );
        if (!keyArn) {
          const desc = await secrets.send(
            new DescribeSecretCommand({ SecretId: name })
          );
          keyArn = desc.ARN ?? undefined;
        }
      } else {
        const created = await secrets.send(
          new CreateSecretCommand({
            Name: name,
            Description: `Wiki LLM API key for brain ${brainId} (${provider})`,
            SecretString: apiKey,
          })
        );
        keyArn = created.ARN ?? undefined;
      }
    }

    if (!keyArn) {
      return NextResponse.json(
        { error: "An API key is required for this provider" },
        { status: 400 }
      );
    }

    await db
      .update(brains)
      .set({
        wikiModelProvider: provider,
        wikiModelId: modelId,
        wikiLlmKeySecretArn: keyArn,
        updatedAt: new Date(),
      })
      .where(and(eq(brains.orgId, auth.orgId), eq(brains.id, brainId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("wiki-model save failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
