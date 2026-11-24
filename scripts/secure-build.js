const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
module.exports = async (context) => {
  const target =
    context.electronPlatformName === "darwin"
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
        )
      : path.join(
          context.appOutDir,
          context.packager.appInfo.productFilename +
            (context.electronPlatformName === "win32" ? ".exe" : ""),
        );
  await flipFuses(target, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === "darwin",
    [FuseV1Options.EnableCookieEncryption]: true,
  });
};
