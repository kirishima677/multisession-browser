const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("apiClient", {
  invoke: (action, payload = {}) =>
    ipcRenderer.invoke("api-client:command", action, payload),
  onState: (callback) =>
    ipcRenderer.on("api-client:state", (_event, state) => callback(state)),
  onFocusURL: (callback) => ipcRenderer.on("api-client:focus-url", callback),
});
