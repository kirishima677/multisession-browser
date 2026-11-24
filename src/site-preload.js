const { contextBridge, ipcRenderer } = require("electron");

// This unsigned build has no platform authenticator. Reject WebAuthn explicitly
// instead of leaving Google and other sign-in pages waiting for an absent UI.
// No credential data, challenge or RP identifier is sent to the main process.
window.addEventListener("msb:passkey-unavailable", () => {
  ipcRenderer.send("browser:passkey-unavailable");
});
contextBridge.executeInMainWorld({
  func: () => {
    const credentials = navigator.credentials;
    if (!credentials) return;
    const prototype = Object.getPrototypeOf(credentials);
    for (const method of ["get", "create"]) {
      const original = prototype[method];
      if (typeof original !== "function") continue;
      Object.defineProperty(prototype, method, {
        configurable: true,
        writable: true,
        value: function (options) {
          if (options && typeof options === "object" && options.publicKey) {
            if (options.signal?.aborted)
              return Promise.reject(options.signal.reason);
            // Conditional requests are background autofill probes; don't show a banner.
            if (options.mediation !== "conditional")
              window.dispatchEvent(new Event("msb:passkey-unavailable"));
            return Promise.reject(
              new DOMException(
                "Passkeys are not supported in this build of Multisession Browser. Choose another sign-in method on this website.",
                "NotAllowedError",
              ),
            );
          }
          return Reflect.apply(original, this, arguments);
        },
      });
    }
    if (typeof PublicKeyCredential !== "undefined") {
      for (const method of [
        "isUserVerifyingPlatformAuthenticatorAvailable",
        "isConditionalMediationAvailable",
      ]) {
        if (typeof PublicKeyCredential[method] === "function")
          Object.defineProperty(PublicKeyCredential, method, {
            configurable: true,
            writable: true,
            value: () => Promise.resolve(false),
          });
      }
    }
  },
});
