import { main as realMain } from "../src/main.js";
import { tempHome } from "./helpers.js";

export async function main(argv, ctx = {}) {
  if (ctx.homeDir) return realMain(argv, ctx);
  return realMain(argv, { ...ctx, homeDir: await tempHome() });
}
