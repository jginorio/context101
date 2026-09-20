"use client";

import * as React from "react";

import {
  GOOGLE_DOC_MIME,
  GOOGLE_PICKER_MIME_TYPES,
  GOOGLE_PICKER_SCOPES,
  GOOGLE_SHEET_MIME,
  GOOGLE_SLIDE_MIME,
  googleFileFromPickerDoc,
  type PickedGoogleFile,
} from "@/lib/google-source";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";

type CodeClient = {
  requestCode: () => void;
};

type CodeResponse = {
  code?: string;
  error?: string;
  error_description?: string;
};

type PickerDoc = {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
};

type PickerCallbackData = {
  action?: string;
  docs?: PickerDoc[];
};

declare global {
  interface Window {
    gapi?: {
      load: (api: string, cb: () => void) => void;
    };
    google?: {
      accounts?: {
        oauth2?: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode?: "popup" | "redirect";
            callback?: (response: CodeResponse) => void;
            error_callback?: (error: { message?: string; type?: string }) => void;
          }) => CodeClient;
        };
      };
      picker?: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new (viewId?: string) => GoogleDocsView;
        ViewId: {
          DOCS: string;
          DOCUMENTS: string;
          SPREADSHEETS: string;
          PRESENTATIONS: string;
        };
        Action: { PICKED: string; CANCEL: string };
        DocsViewMode: { LIST: string; GRID: string };
      };
    };
  }
}

type GoogleDocsView = {
  setMimeTypes: (mimeTypes: string) => GoogleDocsView;
  setMode: (mode: string) => GoogleDocsView;
  setIncludeFolders: (include: boolean) => GoogleDocsView;
};

type GooglePickerBuilder = {
  addView: (view: GoogleDocsView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  setOrigin: (origin: string) => GooglePickerBuilder;
  enableFeature?: (feature: string) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${src}"]`
  );
  if (existing) {
    if (existing.dataset.loaded === "1") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ${src}`)),
        { once: true }
      );
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadGoogleApis(): Promise<void> {
  await Promise.all([loadScript(GIS_SRC), loadScript(GAPI_SRC)]);
  await new Promise<void>((resolve, reject) => {
    if (!window.gapi?.load) {
      reject(new Error("Google API loader is unavailable"));
      return;
    }
    window.gapi.load("picker", () => resolve());
  });
}

export function requestGoogleAuthCode(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const init = window.google?.accounts?.oauth2?.initCodeClient;
    if (!init) {
      reject(new Error("Google sign-in is unavailable"));
      return;
    }
    const client = init({
      client_id: clientId,
      scope: GOOGLE_PICKER_SCOPES.join(" "),
      ux_mode: "popup",
      // GIS's typed config omits these; the code client honors them so
      // the server can store a refresh_token and skip a second consent.
      ...({
        access_type: "offline",
        prompt: "consent",
      } as Record<string, string>),
      callback: (response) => {
        if (response.code) {
          resolve(response.code);
          return;
        }
        reject(
          new Error(
            response.error_description ||
              response.error ||
              "Google authorization was cancelled"
          )
        );
      },
      error_callback: (error) => {
        reject(
          new Error(error.message || "Google authorization was cancelled")
        );
      },
    });
    client.requestCode();
  });
}

export function openGooglePicker(input: {
  accessToken: string;
  apiKey: string;
  appId: string;
}): Promise<PickedGoogleFile | null> {
  return new Promise((resolve, reject) => {
    const pickerNs = window.google?.picker;
    if (!pickerNs) {
      reject(new Error("Google Picker is unavailable"));
      return;
    }

    const all = new pickerNs.DocsView()
      .setMimeTypes(GOOGLE_PICKER_MIME_TYPES.join(","))
      .setIncludeFolders(false);
    const docs = new pickerNs.DocsView(pickerNs.ViewId.DOCUMENTS).setMimeTypes(
      GOOGLE_DOC_MIME
    );
    const sheets = new pickerNs.DocsView(
      pickerNs.ViewId.SPREADSHEETS
    ).setMimeTypes(GOOGLE_SHEET_MIME);
    const slides = new pickerNs.DocsView(
      pickerNs.ViewId.PRESENTATIONS
    ).setMimeTypes(GOOGLE_SLIDE_MIME);

    const picker = new pickerNs.PickerBuilder()
      .addView(all)
      .addView(docs)
      .addView(sheets)
      .addView(slides)
      .setOAuthToken(input.accessToken)
      .setDeveloperKey(input.apiKey)
      .setAppId(input.appId)
      .setTitle("Select a Google file")
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (data.action === pickerNs.Action.CANCEL) {
          resolve(null);
          return;
        }
        if (data.action !== pickerNs.Action.PICKED) return;
        const picked = googleFileFromPickerDoc(data.docs?.[0]);
        if (!picked) {
          reject(
            new Error(
              "Pick a Google Doc, Sheet, or Slides deck. Other Drive files aren't synced."
            )
          );
          return;
        }
        resolve(picked);
      })
      .build();
    picker.setVisible(true);
  });
}

export function useGooglePickerScripts() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadGoogleApis()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ready, error };
}
