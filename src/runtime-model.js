const path = require("node:path");
const os = require("node:os");
function preferences(input = {}) {
  const result = {
    memoryWarningMiB: input.memoryWarningMiB ?? 2048,
    checkUpdatesOnStartup: input.checkUpdatesOnStartup ?? true,
  };
  if (
    !Number.isInteger(result.memoryWarningMiB) ||
    result.memoryWarningMiB < 0 ||
    result.memoryWarningMiB > 65536 ||
    (result.memoryWarningMiB > 0 && result.memoryWarningMiB < 256)
  )
    throw new Error(
      "警告値は256〜65536 MiB、無効にする場合は0を指定してください。",
    );
  if (typeof result.checkUpdatesOnStartup !== "boolean")
    throw new Error("更新確認の設定が不正です。");
  return result;
}
function terminalDefinition(input = {}) {
  const cwd = input.cwd ?? os.homedir();
  if (
    typeof cwd !== "string" ||
    !cwd ||
    cwd.length > 4096 ||
    cwd.includes("\0") ||
    !path.isAbsolute(cwd)
  )
    throw new Error("起動フォルダは絶対パスで指定してください。");
  return { cwd: path.normalize(cwd) };
}
function compareVersions(left, right) {
  const parse = (value) => {
    if (
      typeof value !== "string" ||
      !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    )
      throw new Error("リリースのバージョン形式を確認できません。");
    const parts = value.replace(/^v/, "").split(".").map(Number);
    if (parts.some((n) => !Number.isSafeInteger(n)))
      throw new Error("バージョン値が不正です。");
    return parts;
  };
  const a = parse(left),
    b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
module.exports = { preferences, terminalDefinition, compareVersions };
