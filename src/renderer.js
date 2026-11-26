import { $ } from "./ui/dom.mjs";
import { createUIState } from "./ui/state.mjs";
import { createModal } from "./ui/modal.mjs";
import { createDialogs } from "./ui/dialogs.mjs";
import { createRuntimeView } from "./ui/runtime-view.mjs";
import { createTabView } from "./ui/tab-view.mjs";
import { createTabDrag } from "./ui/tab-drag.mjs";
import { createShellView } from "./ui/shell-view.mjs";

const api = window.browserAPI;
const ui = createUIState();
const getState = ui.get;
const runtimeView = createRuntimeView({ getState });
const modal = createModal({ invoke });
const dialogs = createDialogs({
  getState,
  activeTab: ui.activeTab,
  invoke,
  modal,
  renderRuntime: runtimeView.render,
  setError: ui.setError,
});
const drag = createTabDrag({
  getState,
  invoke,
  render,
  clearDragClasses: () => tabs.clearDragClasses(),
});
const tabs = createTabView({
  getState,
  invoke,
  newTabModal: dialogs.newTabModal,
  beginDrag: drag.begin,
  isClickSuppressed: drag.isClickSuppressed,
});
const shellView = createShellView({
  getState,
  activeTab: ui.activeTab,
  getError: ui.getError,
  invoke,
  render,
  sessionModal: dialogs.sessionModal,
});
function render(next) {
  if (!ui.accept(next)) return;
  shellView.renderSessions();
  tabs.renderTabs();
  tabs.renderSplit();
  runtimeView.render();
  shellView.renderWorksets();
  shellView.renderToolbar();
}
async function invoke(action, payload = {}) {
  try {
    const result = await api.invoke(action, payload);
    if (result.error) throw new Error(result.error);
    ui.setError("");
    render(result);
    return result;
  } catch (error) {
    ui.setError(error.message);
    $("#error").textContent = ui.getError();
    if ($("#modal").open) $("#modal-error").textContent = ui.getError();
    return null;
  }
}
$("#back").addEventListener("click", () => invoke("back"));
$("#forward").addEventListener("click", () => invoke("forward"));
$("#reload").addEventListener("click", () => invoke("reload"));
$("#devtools").addEventListener("click", () => invoke("devtools"));
$("#bookmark-page").addEventListener("click", dialogs.bookmarkModal);
$("#browser-menu").addEventListener("click", () => {
  const rect = $("#browser-menu").getBoundingClientRect();
  invoke("browser-menu", { x: rect.right - 250, y: rect.bottom });
});
$("#open-auth").addEventListener("click", () =>
  invoke("open-test-tools", { page: "auth" }),
);
$("#open-network").addEventListener("click", () =>
  invoke("open-test-tools", { page: "network" }),
);
$("#new-terminal").addEventListener("click", () =>
  dialogs.newTabModal(false, "terminal"),
);
$("#app-info").addEventListener("click", dialogs.appInfoModal);
$("#memory-usage").addEventListener("click", dialogs.appInfoModal);
$("#dismiss-memory-warning").addEventListener("click", () =>
  invoke("dismiss-memory-warning"),
);
$("#open-update").addEventListener("click", () => invoke("open-update"));
$("#new-api").addEventListener("click", () =>
  dialogs.newTabModal(false, "api"),
);
$("#open-as").addEventListener("click", () => dialogs.newTabModal(true));
$("#add-session").addEventListener("click", () => dialogs.sessionModal());
$("#save-workset").addEventListener("click", dialogs.saveWorksetModal);
$("#focus-address").addEventListener("click", shellView.focusAddress);

$("#dismiss-auth-notice").addEventListener("click", () =>
  invoke("dismiss-auth-notice"),
);
api.subscribe(render);
api.onShortcut((name) => {
  if (drag.isActive() || $("#modal").open) return;
  if (name === "address") shellView.focusAddress();
  if (name === "new-tab") dialogs.newTabModal();
  if (name === "new-terminal-tab") dialogs.newTabModal(false, "terminal");
  if (name === "app-info") dialogs.appInfoModal();
  if (name === "new-api-tab") dialogs.newTabModal(false, "api");
  if (name === "save-workset") dialogs.saveWorksetModal();
  if (name === "bookmark-page") dialogs.bookmarkModal();
});
api.onRuntime((value) => {
  if (ui.mergeRuntime(value)) runtimeView.render();
});
invoke("state");
