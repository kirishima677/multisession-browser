const { test } = require("node:test");
const assert = require("node:assert/strict");
const { defaults, validateConfig } = require("../../src/model");
const { preferences, terminalDefinition } = require("../../src/runtime-model");

test("runtime preferences and terminal definitions validate and migrate existing workspaces", () => {
  assert.deepEqual(preferences(), {
    memoryWarningMiB: 2048,
    checkUpdatesOnStartup: true,
  });
  assert.equal(preferences({ memoryWarningMiB: 0 }).memoryWarningMiB, 0);
  for (const memoryWarningMiB of [-1, 128, 70000, NaN])
    assert.throws(() => preferences({ memoryWarningMiB }));
  assert.throws(() => preferences({ checkUpdatesOnStartup: "yes" }));
  assert.equal(terminalDefinition({ cwd: "/tmp/a/../b" }).cwd, "/tmp/b");
  assert.throws(() => terminalDefinition({ cwd: "relative" }));
  const config = defaults();
  delete config.preferences;
  config.worksets.push({
    id: require("node:crypto").randomUUID(),
    name: "CLI",
    tabs: [
      {
        kind: "terminal",
        sessionId: config.sessions[0].id,
        terminal: { cwd: "/tmp" },
        url: "about:blank",
      },
    ],
  });
  assert.equal(validateConfig(config).preferences.memoryWarningMiB, 2048);
  config.worksets[0].tabs[0].terminal.cwd = "relative";
  assert.throws(() => validateConfig(config));
});
