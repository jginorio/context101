export const TAGLINE = "your context. every agent.";

const MAGENTA = [184, 85, 201];
const VIOLET = [139, 92, 246];
const DUSTY = [168, 158, 180];
const MAGENTA_256 = 170;
const VIOLET_256 = 99;
const DUSTY_256 = 139;

function enabled(stream, env = process.env) {
  const e = env ?? process.env;
  if (e.NO_COLOR) return false;
  if (e.FORCE_COLOR === "0") return false;
  return Boolean(stream && stream.isTTY);
}

function truecolor() {
  const colorterm = String(process.env.COLORTERM || "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return true;
  const term = String(process.env.TERM || "").toLowerCase();
  return term.includes("truecolor") || term.includes("direct");
}

function fg(rgb, fallback256) {
  if (truecolor()) return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return `\x1b[38;5;${fallback256}m`;
}

export function palette(stream = process.stdout, env = process.env) {
  if (!enabled(stream, env)) {
    return { magenta: "", violet: "", dim: "", red: "", bold: "", reset: "" };
  }
  return {
    magenta: fg(MAGENTA, MAGENTA_256),
    violet: fg(VIOLET, VIOLET_256),
    dim: fg(DUSTY, DUSTY_256),
    red: "\x1b[31m",
    bold: "\x1b[1m",
    reset: "\x1b[0m",
  };
}

export function writers(io) {
  const out = io.stdout;
  const err = io.stderr;
  const c = palette(out, io.env ?? process.env);
  return {
    c,
    write(line = "") {
      out.write(`${line}\n`);
    },
    ok(msg) {
      out.write(`${c.magenta}✓${c.reset} ${msg}\n`);
    },
    warn(msg) {
      err.write(`${c.violet}!${c.reset} ${msg}\n`);
    },
    err(msg) {
      err.write(`${c.red}✗${c.reset} ${msg}\n`);
    },
    dim(msg) {
      out.write(`${c.dim}${msg}${c.reset}\n`);
    },
    bold(msg) {
      out.write(`${c.bold}${msg}${c.reset}\n`);
    },
  };
}

export function banner(io) {
  const { c, write } = writers(io);
  write();
  write(`${c.bold}${c.magenta}Context101${c.reset}`);
  write(`${c.dim}${TAGLINE}${c.reset}`);
  write();
}
