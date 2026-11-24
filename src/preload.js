const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("browserAPI", {
  invoke: (action, payload = {}) =>
    ipcRenderer.invoke("browser:command", action, payload),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("browser:state", listener);
    return () => ipcRenderer.removeListener("browser:state", listener);
  },
  onShortcut: (callback) =>
    ipcRenderer.on("browser:shortcut", (_event, name) => callback(name)),
});
