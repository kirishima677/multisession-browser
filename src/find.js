const api = window.findAPI;
const query = document.querySelector("#query");
function render(state) {
  if (state.error) {
    document.querySelector("#matches").textContent = state.error;
    return;
  }
  if (state.query !== query.value) return;
  document.querySelector("#matches").textContent = state.query
    ? `${state.active || 0} / ${state.matches || 0} 件`
    : "検索語を入力してください";
}
async function invoke(action, payload) {
  try {
    render(await api.invoke(action, payload));
  } catch {
    document.querySelector("#matches").textContent = "検索できませんでした";
  }
}
query.addEventListener("input", () => {
  invoke("search", { query: query.value });
});
document.querySelector("#find-form").addEventListener("submit", (event) => {
  event.preventDefault();
  invoke("next");
});
document
  .querySelector("#previous")
  .addEventListener("click", () => invoke("previous"));
document.querySelector("#close").addEventListener("click", () => api.close());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    api.close();
  } else if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    invoke("previous");
  }
});
api.onState(render);
api.onFocus(() => {
  api.invoke("state").then((state) => {
    query.value = state.query;
    render(state);
    query.focus();
    query.select();
  });
});
api.invoke("state").then((state) => {
  query.value = state.query;
  render(state);
  query.focus();
  query.select();
});
