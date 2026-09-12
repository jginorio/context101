import { randomBytes } from "node:crypto";

export function generateSecret() {
  return randomBytes(32).toString("base64");
}

export function generateCtxToken() {
  return randomBytes(32).toString("base64url");
}
