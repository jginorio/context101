export type AppMode = "self_hosted" | "hosted";

type Env = NodeJS.Dict<string>;

function envFlag(name: string, fallback: boolean, env: Env = process.env): boolean {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/** Only `APP_MODE=hosted` is Hosted. Unset / anything else is self-host. */
export function resolveAppMode(env: Env = process.env): AppMode {
  const value = env.APP_MODE;
  if (value === "hosted" || value === "self_hosted") return value;
  return "self_hosted";
}

export function isHostedDeployment(env: Env = process.env): boolean {
  return resolveAppMode(env) === "hosted";
}

const mode = resolveAppMode();

export const deploymentConfig = {
  appMode: mode,
  isHosted: isHostedDeployment(),
  isSelfHosted: mode === "self_hosted",
  allowPublicSignup: envFlag("ALLOW_PUBLIC_SIGNUP", mode === "hosted"),
  billingEnabled: envFlag("BILLING_ENABLED", mode === "hosted"),
  appUrl: process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
};
