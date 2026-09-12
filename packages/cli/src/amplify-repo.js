import { DEFAULT_AMPLIFY_REPO } from "./defaults.js";

/** Only this GitHub login gets a default Amplify watch target. */
export const AMPLIFY_OWNER_LOGIN = "jginorio";

export function detectGithubLogin(exec) {
  if (!exec) return "";
  const result = exec({
    command: "gh",
    args: ["api", "user", "--jq", ".login"],
  });
  if (!result.ok) return "";
  return String(result.stdout || "").trim();
}

/**
 * Amplify is opt-in. A checkout of this repo must not watch
 * jginorio/context101 unless that user is logged in on the machine,
 * or they passed --repo.
 */
export function defaultAmplifyRepository({ repo, ghLogin } = {}) {
  if (repo) return repo;
  if (ghLogin === AMPLIFY_OWNER_LOGIN) return DEFAULT_AMPLIFY_REPO;
  return "";
}
