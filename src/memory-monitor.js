const { readTree, descendants } = require("./process-tree");
function summarize(metrics, rows, terminalPids) {
  const appPids = new Set(metrics.map((p) => p.pid));
  const chromiumKiB = metrics.reduce(
    (total, p) => total + Math.max(0, p.memory?.workingSetSize || 0),
    0,
  );
  const cli = descendants(rows, terminalPids).filter(
    (p) => !appPids.has(p.pid),
  );
  return {
    bytes: (chromiumKiB + cli.reduce((sum, p) => sum + p.rssKiB, 0)) * 1024,
    processes: metrics.length + cli.length,
    cliProcesses: cli.length,
  };
}
function createMemoryMonitor({ app, terminalPids, threshold, publish }) {
  let value = {
      bytes: 0,
      processes: 0,
      cliProcesses: 0,
      sampledAt: null,
      warning: false,
      dismissed: false,
      error: "",
    },
    running = false,
    timer;
  async function sample() {
    if (running) return value;
    running = true;
    try {
      const pids = terminalPids();
      const rows = pids.length ? await readTree() : [];
      const measured = summarize(app.getAppMetrics(), rows, pids);
      const limit = threshold() * 1024 * 1024;
      const warning = limit > 0 && measured.bytes >= limit;
      const reset = !limit || measured.bytes < limit * 0.9;
      value = {
        ...measured,
        sampledAt: new Date().toISOString(),
        warning,
        dismissed: reset ? false : value.dismissed,
        error: "",
      };
    } catch (error) {
      value = { ...value, error: `メモリ取得に失敗しました：${error.message}` };
    } finally {
      running = false;
      publish();
    }
    return value;
  }
  return {
    get: () => value,
    sample,
    start: () => {
      sample();
      timer = setInterval(sample, 3000);
      timer.unref();
    },
    stop: () => clearInterval(timer),
    dismiss: () => {
      value.dismissed = true;
      publish();
    },
    reset: () => {
      value.dismissed = false;
      return sample();
    },
  };
}
module.exports = { summarize, createMemoryMonitor };
