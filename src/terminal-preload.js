const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("terminalAPI", {
  invoke: (action, payload = {}) =>
    ipcRenderer.invoke("terminal:command", action, payload),
  write: (data) => ipcRenderer.send("terminal:input", { data }),
  resize: (cols, rows) => ipcRenderer.send("terminal:resize", { cols, rows }),
  acknowledge: (epoch, seq) => ipcRenderer.send("terminal:ack", { epoch, seq }),
  onData: (callback) =>
    ipcRenderer.on("terminal:data", (_event, value) => callback(value)),
  onState: (callback) =>
    ipcRenderer.on("terminal:state", (_event, value) => callback(value)),
});
