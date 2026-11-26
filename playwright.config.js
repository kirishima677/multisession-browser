module.exports = {
  testDir: "./test/e2e",
  testMatch: "**/*.spec.js",
  timeout: 45000,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
};
