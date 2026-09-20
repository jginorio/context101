import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { readAuthContext, deniedAuthJson } from "@/lib/brains-server";
import {
  getGoogleOAuthClient,
  resolveGooglePickerKeys,
} from "@/utils/google-oauth";

/**
 * GET /api/connectors/google/picker-config
 *
 * Public (non-secret) Google Picker + GIS settings for the add-source
 * dialog. `clientId` is the OAuth web client id — designed to live in
 * the browser. Never returns `client_secret`.
 */
export async function GET(request: NextRequest) {
  const auth = await readAuthContext(request);
  if (!auth.ok) return deniedAuthJson(auth);

  const client = await getGoogleOAuthClient();
  const { apiKey, appId } = resolveGooglePickerKeys(client);
  return NextResponse.json({
    oauthConfigured: Boolean(client?.client_id),
    pickerConfigured: Boolean(client?.client_id && apiKey && appId),
    clientId: client?.client_id ?? "",
    apiKey,
    appId,
  });
}
