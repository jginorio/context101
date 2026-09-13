import { isExitPromptError, printCancelled } from "./cancel.js";
import { helpText, parseArgs } from "./parse-args.js";
import { runConfig } from "./config.js";
import { runDeploy } from "./deploy.js";
import { runInit } from "./init.js";
import { runDestroy, runList } from "./stacks.js";
import { runUrls } from "./urls.js";
import { banner, writers } from "./style.js";
import { maybeOfferUpdate, versionLine } from "./update.js";

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
    // await so Inquirer ExitPromptError is caught; a bare return leaks the rejection
    if (opts.command === "version" && !opts.help) {
      io.write(versionLine(ctx));
      return 0;
    }

    banner(ctx);
    const updateCode = await maybeOfferUpdate(opts, ctx);
    if (updateCode !== null) return updateCode;

    if (opts.help || opts.command === "help") {
      const topic =
        opts.helpTopic ?? (opts.command !== "help" ? opts.command : null);
      io.write(helpText(topic));
      return 0;
    }

    if (opts.command === "deploy" || opts.command === "diff" || opts.command === "synth") {
      return await runDeploy(opts, ctx);
    }
    if (opts.command === "list") {
      return await runList(opts, ctx);
    }
    if (opts.command === "urls") {
      return await runUrls(opts, ctx);
    }
    if (opts.command === "destroy") {
      return await runDestroy(opts, ctx);
    }
    if (opts.command === "config") {
      return await runConfig(opts, ctx);
    }

    return await runInit(opts, ctx);
  } catch (error) {
    if (isExitPromptError(error)) {
      return printCancelled(io);
    }
    throw error;
  }
}
