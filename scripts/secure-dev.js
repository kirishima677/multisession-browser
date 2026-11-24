const {
  getCurrentFuseWire,
  flipFuses,
  FuseVersion,
  FuseV1Options,
} = require("@electron/fuses");
(async () => {
  const target = require("electron");
  const wire = await getCurrentFuseWire(target);
  if (wire[FuseV1Options.EnableCookieEncryption] !== 49)
    await flipFuses(target, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: process.platform === "darwin",
      [FuseV1Options.EnableCookieEncryption]: true,
    });
})().catch((error) => {
  process.stderr.write(`Cookie暗号化の準備に失敗しました：${error.message}\n`);
  process.exitCode = 1;
});
