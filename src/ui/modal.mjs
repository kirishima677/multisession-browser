import { $ } from "./dom.mjs";

export function createModal({ invoke }) {
  let modalSubmit,
    modalClosing = false;
  async function showModal(title, submitText, build, submit) {
    if ($("#modal").open || modalClosing) return;
    const result = await invoke("overlay", { open: true });
    if (!result) return;
    $("#modal-title").textContent = title;
    $("#modal-submit").textContent = submitText;
    $("#modal-error").textContent = "";
    $("#modal-body").replaceChildren();
    build($("#modal-body"));
    modalSubmit = submit;
    $("#modal").showModal();
    $("#modal-body").querySelector("input, select, button")?.focus();
  }
  async function closeModal() {
    if (modalClosing) return;
    modalClosing = true;
    $("#modal").close();
    modalSubmit = null;
    await invoke("overlay", { open: false });
    modalClosing = false;
  }
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeModal();
  });
  $("#modal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!modalSubmit) return;
    $("#modal-submit").disabled = true;
    try {
      const result = await modalSubmit();
      if (result) await closeModal();
    } finally {
      $("#modal-submit").disabled = false;
    }
  });
  return { show: showModal, close: closeModal };
}
