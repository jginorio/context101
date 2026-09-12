import { isExitPromptError, printCancelled } from "./cancel.js";
import { helpText, parseArgs } from "./parse-args.js";
import { runConfig } from "./config.js";
import { runDeploy } from "./deploy.js";
import { runInit } from "./init.js";
import { runDestroy, runList } from "./stacks.js";
import { banner, writers } from "./style.js";

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

  try {
    if (opts.help || opts.command === "help") {
      const topic =
        opts.helpTopic ?? (opts.command !== "help" ? opts.command : null);
      banner(ctx);
      io.write(helpText(topic));
      return 0;
    }

    if (opts.command === "deploy" || opts.command === "diff" || opts.command === "synth") {
      return runDeploy(opts, ctx);
    }
    if (opts.command === "list") {
      return runList(opts, ctx);
    }
    if (opts.command === "destroy") {
      return runDestroy(opts, ctx);
    }
    if (opts.command === "config") {
      return runConfig(opts, ctx);
    }

    return runInit(opts, ctx);
  } catch (error) {
    if (isExitPromptError(error)) {
      return printCancelled(io);
    }
    throw error;
  }
}
