const { WebContentsView, ipcMain, dialog } = require("electron");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const path = require("node:path");
const { terminalDefinition } = require("./runtime-model");
const { terminate } = require("./process-tree");
function createTerminalTabs({
  tabs,
  window,
  profileFor,
  activate,
  layout,
  publish,
  installKeyboard,
  installContextMenu,
  securePreferences,
}) {
  const file = path.join(__dirname, "terminal.html"),
    url = pathToFileURL(file).href;
  function state(t, buffer = false) {
    const s = profileFor(t.sessionId);
    return {
      id: t.id,
      phase: t.phase,
      epoch: t.epoch,
      seq: t.seq,
      cwd: t.terminal.cwd,
      shell: t.shell,
      pid: t.phase === "running" ? t.pty?.pid : null,
      exitCode: t.exitCode,
      error: t.terminalError || "",
      session: { name: s.name, color: s.color },
      ...(buffer ? { buffer: t.buffer } : {}),
    };
  }
  function notify(t) {
    if (tabs.get(t.id) === t && !t.view.webContents.isDestroyed())
      t.view.webContents.send("terminal:state", state(t));
  }
  function stop(t) {
    if (t.pty && t.phase === "running") {
      const pty = t.pty;
      t.phase = "stopped";
      terminate(pty.pid);
      try {
        pty.kill();
      } catch {}
      t.pty = null;
    }
  }
  function start(t) {
    if (t.phase === "running") return;
    try {
      if (!fs.statSync(t.terminal.cwd).isDirectory())
        throw new Error("起動フォルダが存在しません。");
      const shell = process.env.SHELL || "/bin/zsh";
      if (!path.isAbsolute(shell) || !fs.statSync(shell).isFile())
        throw new Error("ログインシェルが見つかりません。");
      const env = {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "Multisession Browser",
      };
      for (const key of [
        "ELECTRON_RUN_AS_NODE",
        "NODE_OPTIONS",
        "NODE_PATH",
        "MSB_USER_DATA",
        "MSB_UPDATE_URL",
      ])
        delete env[key];
      t.epoch++;
      t.seq = 0;
      t.pending = [];
      t.pendingBytes = 0;
      t.paused = false;
      t.buffer = "";
      t.terminalError = "";
      t.exitCode = null;
      const pty = require("node-pty").spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: t.cols,
        rows: t.rows,
        cwd: t.terminal.cwd,
        env,
      });
      t.pty = pty;
      t.shell = shell;
      t.phase = "running";
      const epoch = t.epoch;
      pty.onData((data) => {
        if (tabs.get(t.id) !== t || t.epoch !== epoch) return;
        t.buffer = (t.buffer + data).slice(-128000);
        const seq = ++t.seq,
          bytes = Buffer.byteLength(data);
        t.pending.push({ seq, bytes });
        t.pendingBytes += bytes;
        if (!t.paused && t.pendingBytes > 256 * 1024) {
          pty.pause();
          t.paused = true;
        }
        if (!t.view.webContents.isDestroyed())
          t.view.webContents.send("terminal:data", { epoch, seq, data });
      });
      pty.onExit(({ exitCode }) => {
        if (tabs.get(t.id) !== t || t.epoch !== epoch) return;
        t.phase = "exited";
        t.exitCode = exitCode;
        t.pty = null;
        notify(t);
        publish();
      });
    } catch (error) {
      t.phase = "error";
      t.terminalError = `シェルを起動できませんでした：${error.message}`;
    }
    notify(t);
    publish();
  }
  function create(sessionId, input = {}, autoStart = true) {
    profileFor(sessionId);
    const terminal = terminalDefinition(input);
    const view = new WebContentsView({
      webPreferences: {
        ...securePreferences,
        preload: path.join(__dirname, "terminal-preload.js"),
      },
    });
    const t = {
      id: randomUUID(),
      kind: "terminal",
      sessionId,
      view,
      terminal,
      phase: "idle",
      epoch: 0,
      seq: 0,
      buffer: "",
      cols: 100,
      rows: 30,
      title: `CLI / ${path.basename(terminal.cwd) || terminal.cwd}`,
      pending: [],
      pendingBytes: 0,
    };
    tabs.set(t.id, t);
    window().contentView.addChildView(view);
    view.setBackgroundColor("#141b2b");
    installKeyboard(view.webContents);
    installContextMenu(view.webContents);
    view.webContents.on("will-navigate", (e) => e.preventDefault());
    view.webContents.on("will-redirect", (e) => e.preventDefault());
    view.webContents.on("will-attach-webview", (e) => e.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("focus", () => {
      if (tabs.has(t.id) && view.getVisible()) {
        activate(t.id);
        layout();
        publish();
      }
    });
    view.webContents.once("destroyed", () => stop(t));
    activate(t.id);
    view.webContents.loadFile(file);
    layout();
    publish();
    if (autoStart) start(t);
    return t;
  }
  function authorize(event) {
    const t = [...tabs.values()].find(
      (t) => t.kind === "terminal" && t.view.webContents === event.sender,
    );
    if (
      !t ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== url
    )
      throw new Error("許可されていないターミナル操作です。");
    return t;
  }
  ipcMain.handle("terminal:command", async (event, action, p = {}) => {
    const t = authorize(event);
    try {
      if (!p || typeof p !== "object")
        throw new Error("操作の形式が不正です。");
      if (action === "start") start(t);
      else if (action === "stop") {
        stop(t);
        notify(t);
        publish();
      } else if (action === "choose-directory") {
        if (t.phase === "running")
          throw new Error(
            "シェルを停止してから起動フォルダを変更してください。",
          );
        const result = await dialog.showOpenDialog(window(), {
          title: "ターミナルの起動フォルダ",
          defaultPath: t.terminal.cwd,
          properties: ["openDirectory"],
        });
        if (!result.canceled && tabs.get(t.id) === t) {
          t.terminal = terminalDefinition({ cwd: result.filePaths[0] });
          t.title = `CLI / ${path.basename(t.terminal.cwd) || t.terminal.cwd}`;
          notify(t);
          publish();
        }
      } else if (action !== "state")
        throw new Error("未対応のターミナル操作です。");
      return state(t, action === "state");
    } catch (error) {
      return { error: error.message };
    }
  });
  ipcMain.on("terminal:input", (event, p = {}) => {
    try {
      const t = authorize(event);
      if (
        t.phase === "running" &&
        typeof p.data === "string" &&
        p.data.length <= 65536
      )
        t.pty.write(p.data);
    } catch {}
  });
  ipcMain.on("terminal:resize", (event, p = {}) => {
    try {
      const t = authorize(event);
      if (
        !Number.isInteger(p.cols) ||
        !Number.isInteger(p.rows) ||
        p.cols < 2 ||
        p.cols > 500 ||
        p.rows < 1 ||
        p.rows > 300
      )
        return;
      t.cols = p.cols;
      t.rows = p.rows;
      if (t.phase === "running") t.pty.resize(t.cols, t.rows);
    } catch {}
  });
  ipcMain.on("terminal:ack", (event, p = {}) => {
    try {
      const t = authorize(event);
      if (p.epoch !== t.epoch || !Number.isInteger(p.seq) || p.seq > t.seq)
        return;
      t.pending = t.pending.filter((chunk) => {
        if (chunk.seq > p.seq) return true;
        t.pendingBytes -= chunk.bytes;
        return false;
      });
      if (t.paused && t.pendingBytes < 64 * 1024 && t.phase === "running") {
        t.pty.resume();
        t.paused = false;
      }
    } catch {}
  });
  return {
    create,
    stop,
    refresh: () => {
      for (const t of tabs.values()) if (t.kind === "terminal") notify(t);
    },
    pids: () =>
      [...tabs.values()]
        .filter((t) => t.kind === "terminal" && t.phase === "running")
        .map((t) => t.pty.pid),
    shutdown: () => {
      for (const t of tabs.values()) if (t.kind === "terminal") stop(t);
    },
    serialize: (t) => ({
      kind: "terminal",
      sessionId: t.sessionId,
      url: "about:blank",
      terminal: { ...t.terminal },
    }),
  };
}
module.exports = { createTerminalTabs };
