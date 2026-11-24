const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("libraryAPI", {
  invoke: (action, payload = {}) =>
    ipcRenderer.invoke("library:command", action, payload),
  onState: (callback) =>
    ipcRenderer.on("library:state", (_event, value) => callback(value)),
});
