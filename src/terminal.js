const api = window.terminalAPI,
  $ = (selector) => document.querySelector(selector);
const term = new Terminal({
  cursorBlink: true,
  fontFamily: "Menlo, Monaco, monospace",
  fontSize: 12,
  scrollback: 3000,
  theme: { background: "#141b2b", foreground: "#d6dfef", cursor: "#9aabff" },
  allowProposedApi: false,
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($("#terminal"));
let current,
  initialized = false,
  epoch = -1,
  seq = 0,
  pending = [];
function resize() {
  if ($("#terminal").clientWidth < 30 || $("#terminal").clientHeight < 30)
    return;
  fit.fit();
  api.resize(term.cols, term.rows);
}
function onData(message) {
  if (!initialized) {
    pending.push(message);
    return;
  }
  if (message.epoch < epoch) return;
  if (message.epoch !== epoch) {
    term.reset();
    epoch = message.epoch;
    seq = 0;
  }
  if (message.seq <= seq) return;
  seq = message.seq;
  term.write(message.data, () => api.acknowledge(message.epoch, message.seq));
}
function render(state) {
  if (!initialized) return;
  if (state.epoch < epoch) return;
  current = state;
  if (state.epoch !== epoch) {
    term.reset();
    epoch = state.epoch;
    seq = 0;
  }
  $("#session").textContent = state.session.name;
  document.documentElement.style.setProperty("--session", state.session.color);
  $("#cwd").textContent = state.cwd;
  $("#cwd").title = `起動フォルダ：${state.cwd}`;
  $("#phase").textContent =
    state.phase === "running"
      ? `PID ${state.pid}`
      : state.phase === "exited"
        ? `終了 (${state.exitCode})`
        : state.phase === "stopped"
          ? "停止済み"
          : "未起動";
  $("#start").hidden = state.phase === "running";
  $("#stop").hidden = state.phase !== "running";
  $("#directory").disabled = state.phase === "running";
  $("#terminal-error").textContent = state.error;
  $("#terminal-error").hidden = !state.error;
  resize();
}
async function invoke(action) {
  try {
    const result = await api.invoke(action);
    if (result.error && !result.id) throw new Error(result.error);
    render(result);
    if (action === "start") term.focus();
  } catch (error) {
    $("#terminal-error").hidden = false;
    $("#terminal-error").textContent = error.message;
  }
}
term.onData((data) => {
  for (let at = 0; at < data.length; at += 16384)
    api.write(data.slice(at, at + 16384));
});
api.onData(onData);
api.onState(render);
$("#start").addEventListener("click", () => invoke("start"));
$("#stop").addEventListener("click", () => invoke("stop"));
$("#directory").addEventListener("click", () => invoke("choose-directory"));
$("#clear").addEventListener("click", () => term.clear());
new ResizeObserver(resize).observe($("#terminal"));
api
  .invoke("state")
  .then((state) => {
    if (!state.id) throw new Error(state.error);
    initialized = true;
    render(state);
    seq = state.seq;
    term.write(state.buffer || "", () =>
      api.acknowledge(state.epoch, state.seq),
    );
    for (const message of pending) onData(message);
    pending = [];
    resize();
    term.focus();
  })
  .catch((error) => {
    $("#terminal-error").hidden = false;
    $("#terminal-error").textContent = error.message;
  });
