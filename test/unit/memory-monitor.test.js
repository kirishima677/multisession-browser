const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseTree, descendants } = require("../../src/process-tree");
const { summarize, createMemoryMonitor } = require("../../src/memory-monitor");

test("memory accounting includes CLI descendants without counting Electron processes twice", () => {
  const rows = parseTree("10 1 100\n20 10 50\n30 20 25\n40 1 200");
  assert.deepEqual(
    descendants(rows, [20]).map((p) => p.pid),
    [20, 30],
  );
  assert.deepEqual(
    summarize(
      [
        { pid: 10, memory: { workingSetSize: 100 } },
        { pid: 20, memory: { workingSetSize: 50 } },
      ],
      rows,
      [20],
    ),
    { bytes: 175 * 1024, processes: 3, cliProcesses: 1 },
  );
});

test("memory warning dismissal rearms below 90 percent and can be disabled", async () => {
  let kib = 3000 * 1024,
    limit = 2048;
  const monitor = createMemoryMonitor({
    app: { getAppMetrics: () => [{ pid: 1, memory: { workingSetSize: kib } }] },
    terminalPids: () => [],
    threshold: () => limit,
    publish: () => {},
  });
  assert.equal((await monitor.sample()).warning, true);
  monitor.dismiss();
  await monitor.sample();
  assert.equal(monitor.get().dismissed, true);
  kib = 1900 * 1024;
  await monitor.sample();
  assert.equal(monitor.get().dismissed, true);
  kib = 1000 * 1024;
  await monitor.sample();
  assert.equal(monitor.get().dismissed, false);
  kib = 3000 * 1024;
  await monitor.sample();
  assert.equal(monitor.get().warning, true);
  limit = 0;
  await monitor.sample();
  assert.equal(monitor.get().warning, false);
});
