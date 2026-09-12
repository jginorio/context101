#!/usr/bin/env node
import { main } from "../src/main.js";

const code = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
});
process.exit(code);
