const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const args = ["-axo", "pid=,ppid=,rss="];
function parseTree(output) {
  return output
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, ppid, rssKiB] = line.trim().split(/\s+/).map(Number);
      return { pid, ppid, rssKiB };
    })
    .filter(
      (p) => Number.isInteger(p.pid) && p.pid > 0 && Number.isFinite(p.rssKiB),
    );
}
async function readTree() {
  const { stdout } = await run("/bin/ps", args, {
    timeout: 1500,
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseTree(stdout);
}
function descendants(rows, roots) {
  const ids = new Set(roots.filter(Number.isInteger));
  let changed;
  do {
    changed = false;
    for (const p of rows)
      if (ids.has(p.ppid) && !ids.has(p.pid)) {
        ids.add(p.pid);
        changed = true;
      }
  } while (changed);
  return rows.filter((p) => ids.has(p.pid));
}
function terminate(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  let children = [];
  try {
    children = descendants(
      parseTree(
        execFileSync("/bin/ps", args, { encoding: "utf8", timeout: 1500 }),
      ),
      [pid],
    ).map((p) => p.pid);
  } catch {
    children = [pid];
  }
  // Closing a local terminal also stops foreground/background jobs started there.
  for (const id of children.reverse()) {
    if (id === process.pid || id <= 1) continue;
    try {
      process.kill(id, "SIGKILL");
    } catch {}
  }
}
module.exports = { parseTree, descendants, readTree, terminate };
