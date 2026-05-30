export type AppMode = "self_hosted" | "hosted";

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function appMode(): AppMode {
  const value = process.env.APP_MODE;
  if (value === "hosted" || value === "self_hosted") return value;
  return "self_hosted";
}

const mode = appMode();

export const deploymentConfig = {
  appMode: mode,
  isHosted: mode === "hosted",
  isSelfHosted: mode === "self_hosted",
  allowPublicSignup: envFlag("ALLOW_PUBLIC_SIGNUP", mode === "hosted"),
  billingEnabled: envFlag("BILLING_ENABLED", mode === "hosted"),
  appUrl: process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  marketingUrl: process.env.MARKETING_URL ?? "http://localhost:3000",
};
