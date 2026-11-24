const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("testTools", {
  invoke: (action, payload = {}) =>
    ipcRenderer.invoke("test-tools:command", action, payload),
  onState: (callback) =>
    ipcRenderer.on("test-tools:state", (_event, value) => callback(value)),
});
