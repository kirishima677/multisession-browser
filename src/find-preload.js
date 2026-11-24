const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("findAPI", {
  invoke: (action, payload = {}) =>
    ipcRenderer.invoke("page-find:command", action, payload),
  close: () => ipcRenderer.send("page-find:close"),
  onState: (callback) =>
    ipcRenderer.on("page-find:state", (_event, state) => callback(state)),
  onFocus: (callback) => ipcRenderer.on("page-find:focus", callback),
});
