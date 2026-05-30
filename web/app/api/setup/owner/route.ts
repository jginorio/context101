import { NextResponse } from "next/server";

import { getSetupAuth } from "@/lib/auth/server";
import { deploymentConfig } from "@/lib/deployment/config";
import { db } from "@/lib/db/client";
import { organization } from "@/lib/db/auth-schema";

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "team"
  );
}

async function hasAnyOrganization() {
  if (!db) return false;
  const rows = await db.select({ id: organization.id }).from(organization).limit(1);
  return rows.length > 0;
}

export async function POST(request: Request) {
  if (!deploymentConfig.isSelfHosted) {
    return NextResponse.json({ error: "setup is disabled" }, { status: 404 });
  }
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 }
    );
  }
  if (await hasAnyOrganization()) {
    return NextResponse.json(
      { error: "setup has already been completed" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.name !== "string" ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    typeof body.orgName !== "string"
  ) {
    return NextResponse.json(
      { error: "name, email, password, and orgName are required" },
      { status: 400 }
    );
  }

  const auth = getSetupAuth();

  const signup = (await auth.api.signUpEmail({
    body: {
      name: body.name.trim(),
      email: body.email.trim(),
      password: body.password,
    },
  })) as { user?: { id?: string } };

  const userId = signup.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "failed to create owner user" },
      { status: 500 }
    );
  }

  const orgName = body.orgName.trim();
  const org = await auth.api.createOrganization({
    body: {
      name: orgName,
      slug: slugify(orgName),
      userId,
      keepCurrentActiveOrganization: true,
    },
  });

  return NextResponse.json({ ok: true, org });
}
