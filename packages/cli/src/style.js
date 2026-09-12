function enabled(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return Boolean(stream && stream.isTTY);
}

export function palette(stream = process.stdout) {
  if (!enabled(stream)) {
    return { red: "", green: "", yellow: "", bold: "", dim: "", reset: "" };
  }
  return {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
  };
}

export function writers(io) {
  const out = io.stdout;
  const err = io.stderr;
  const c = palette(out);
  return {
    c,
    write(line = "") {
      out.write(`${line}\n`);
    },
    ok(msg) {
      out.write(`${c.green}✓${c.reset} ${msg}\n`);
    },
    warn(msg) {
      err.write(`${c.yellow}!${c.reset} ${msg}\n`);
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
  write(`${c.bold}Context101${c.reset}`);
  write(`${c.dim}self-host setup — web/ + CDK + MCP on your AWS account${c.reset}`);
  write();
}
