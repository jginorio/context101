import { palette } from "./style.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_INTERVAL_MS = 80;

export const LABEL_DEPLOYING = "deploying…";
export const LABEL_DESTROYING = "destroying…";
export const LABEL_DIFFING = "diffing…";
export const LABEL_SYNTH = "synthesizing…";
export const LABEL_STACK_DEPS = "installing stack deps";
export const LABEL_FETCHING = "fetching stack source";

export function actionLabel(action) {
  if (action === "destroy") return LABEL_DESTROYING;
  if (action === "diff") return LABEL_DIFFING;
  if (action === "synth") return LABEL_SYNTH;
  return LABEL_DEPLOYING;
}

export function createProgress({
  stdout,
  env = process.env,
  verbose = false,
  interval = SPINNER_INTERVAL_MS,
  frames = SPINNER_FRAMES,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const stream = stdout;
  const tty = Boolean(stream && stream.isTTY) && !verbose;
  const c = palette(stream, env);
  let timer = null;
  let frame = 0;
  let label = "";
  let active = false;

  function paint() {
    if (!stream || !tty) return;
    const spin = `${c.magenta}${frames[frame % frames.length]}${c.reset}`;
    const text = `${c.dim}${label}${c.reset}`;
    stream.write(`\r\x1b[K ${spin} ${text}`);
    frame += 1;
  }

  function start(nextLabel) {
    stop();
    label = nextLabel;
    if (verbose) return;
    if (!stream) return;
    if (!tty) {
      stream.write(`${label}\n`);
      return;
    }
    active = true;
    frame = 0;
    paint();
    timer = setIntervalFn(paint, interval);
    if (typeof timer?.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearIntervalFn(timer);
      timer = null;
    }
    if (active && stream && tty) {
      stream.write("\r\x1b[K");
    }
    active = false;
    label = "";
  }

  return { start, stop, get label() { return label; }, get active() { return active; } };
}
