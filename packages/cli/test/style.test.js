import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/main.js";
import { banner, palette, TAGLINE, writers } from "../src/style.js";
import { memoryIo, testEnv } from "./helpers.js";

function withEnv(extra, fn) {
  const keys = Object.keys(extra);
  const prev = {};
  for (const key of keys) {
    prev[key] = process.env[key];
    const value = extra[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("banner is the brand mark plus your context. every agent.", () => {
  const io = memoryIo();
  banner(io);
  assert.match(io.stdoutText, /Context101/);
  assert.match(io.stdoutText, /your context\. every agent\./);
  assert.equal(io.stdoutText.includes(TAGLINE), true);
  assert.equal(io.stdoutText.includes("self-host setup"), false);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
  assert.equal(io.stdoutText.includes("site/"), false);
});

test("context101 help inherits the banner", async () => {
  const io = memoryIo();
  const code = await main(["help"], {
    cwd: "/tmp",
    env: testEnv(),
    stdout: io.stdout,
    stderr: io.stderr,
    stdin: io.stdin,
  });
  assert.equal(code, 0);
  assert.match(io.stdoutText, /your context\. every agent\./);
  assert.match(io.stdoutText, /Usage: context101 <command>/);
  assert.equal(io.stdoutText.includes("self-host setup"), false);
  assert.equal(io.stdoutText.includes("deploy.sh"), false);
  assert.equal(io.stdoutText.includes("site/"), false);
});

test("palette is empty without a TTY, with NO_COLOR, or FORCE_COLOR=0", () => {
  const tty = { isTTY: true };
  const plain = { isTTY: false };
  withEnv({ NO_COLOR: undefined, FORCE_COLOR: undefined, COLORTERM: "truecolor" }, () => {
    const off = palette(plain);
    assert.equal(off.magenta, "");
    assert.equal(off.red, "");
  });
  withEnv({ NO_COLOR: "1", FORCE_COLOR: undefined, COLORTERM: "truecolor" }, () => {
    const off = palette(tty);
    assert.equal(off.magenta, "");
    assert.equal(off.violet, "");
  });
  withEnv({ NO_COLOR: undefined, FORCE_COLOR: "0", COLORTERM: "truecolor" }, () => {
    const off = palette(tty);
    assert.equal(off.magenta, "");
  });
});

test("palette uses truecolor magenta on TTY when COLORTERM allows it", () => {
  const tty = { isTTY: true };
  withEnv(
    { NO_COLOR: undefined, FORCE_COLOR: undefined, COLORTERM: "truecolor", TERM: "xterm-256color" },
    () => {
      const c = palette(tty);
      assert.equal(c.magenta, "\x1b[38;2;184;85;201m");
      assert.equal(c.violet, "\x1b[38;2;139;92;246m");
      assert.equal(c.dim, "\x1b[38;2;168;158;180m");
      assert.equal(c.red, "\x1b[31m");
      assert.equal(c.magenta.includes("\x1b[32m"), false);
      assert.equal(c.violet.includes("\x1b[33m"), false);
    }
  );
});

test("palette falls back to 256 color when truecolor is unavailable", () => {
  const tty = { isTTY: true };
  withEnv(
    { NO_COLOR: undefined, FORCE_COLOR: undefined, COLORTERM: undefined, TERM: "xterm-256color" },
    () => {
      const c = palette(tty);
      assert.equal(c.magenta, "\x1b[38;5;170m");
      assert.equal(c.violet, "\x1b[38;5;99m");
      assert.equal(c.dim, "\x1b[38;5;139m");
    }
  );
});

test("ok and warn use brand stops, not traffic-light green or yellow", () => {
  const io = memoryIo();
  io.stdout.isTTY = true;
  withEnv(
    { NO_COLOR: undefined, FORCE_COLOR: undefined, COLORTERM: "truecolor" },
    () => {
      const w = writers(io);
      w.ok("ready");
      w.warn("heads up");
      w.err("failed");
      assert.match(io.stdoutText, /\x1b\[38;2;184;85;201m✓/);
      assert.equal(io.stdoutText.includes("\x1b[32m"), false);
      assert.match(io.stderrText, /\x1b\[38;2;139;92;246m!/);
      assert.equal(io.stderrText.includes("\x1b[33m"), false);
      assert.match(io.stderrText, /\x1b\[31m✗/);
    }
  );
});
