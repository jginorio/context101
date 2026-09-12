import { helpText, parseArgs } from "./parse-args.js";
import { runInit } from "./init.js";
import { writers } from "./style.js";

export async function main(argv, ctx) {
  const io = writers(ctx);
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    if (error && error.code === "USAGE") {
      io.err(error.message);
      io.write(helpText());
      return 1;
    }
    throw error;
  }

  if (opts.help) {
    io.write(helpText());
    return 0;
  }

  return runInit(opts, ctx);
}
