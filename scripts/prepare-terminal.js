// node-pty ships N-API binaries; its spawn helper also needs executable mode on macOS.
const fs = require("node:fs");
const path = require("node:path");
for (const arch of ["arm64", "x64"]) {
  const helper = path.join(
    __dirname,
    "..",
    "node_modules",
    "node-pty",
    "prebuilds",
    `darwin-${arch}`,
    "spawn-helper",
  );
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
