const { createResponseStore, MAX_BODY } = require("./response-store");
function createNetworkCapture({ describe, publish }) {
  const store = createResponseStore(),
    tracked = new Map();
  let recording = false,
    generation = 0,
    notification;
  function changed() {
    clearTimeout(notification);
    notification = setTimeout(publish, 100);
    notification.unref();
  }
  function save(entry) {
    if (recording) {
      store.add(entry);
      changed();
    }
  }
  async function attach(item) {
    if (!recording || item.contents.isDestroyed()) return;
    try {
      if (!item.contents.debugger.isAttached()) {
        item.contents.debugger.attach("1.3");
        item.owned = true;
      } else if (!item.owned) {
        item.error = "別のデバッグ接続を利用中のため記録できません。";
        changed();
        return;
      }
      await item.contents.debugger.sendCommand("Network.enable", {
        maxTotalBufferSize: 5 * MAX_BODY,
        maxResourceBufferSize: MAX_BODY,
        maxPostDataSize: 0,
      });
      item.error = "";
      item.active = true;
    } catch {
      item.error = "このタブの応答記録を開始できません。";
      item.active = false;
    }
    changed();
  }
  function track(contents, sessionId) {
    if (tracked.has(contents.id)) return;
    const item = {
      contents,
      sessionId,
      pending: new Map(),
      owned: false,
      active: false,
      error: "",
    };
    tracked.set(contents.id, item);
    const message = async (_event, method, p) => {
      if (!recording || !item.active) return;
      const run = generation;
      if (method === "Network.requestWillBeSent") {
        if (
          !["XHR", "Fetch"].includes(p.type) ||
          !/^https?:\/\//.test(p.request.url)
        )
          return;
        if (item.pending.size >= 1000)
          item.pending.delete(item.pending.keys().next().value);
        item.pending.set(p.requestId, {
          ...describe(contents),
          sessionId,
          url: p.request.url,
          method: p.request.method,
          createdAt: new Date(
            (p.wallTime || Date.now() / 1000) * 1000,
          ).toISOString(),
          kind: "web",
          contentType: "",
          status: 0,
        });
      } else if (method === "Network.responseReceived") {
        const request = item.pending.get(p.requestId);
        if (request)
          Object.assign(request, {
            status: p.response.status,
            contentType: p.response.mimeType || "",
          });
      } else if (method === "Network.loadingFailed") {
        const request = item.pending.get(p.requestId);
        item.pending.delete(p.requestId);
        if (request)
          save({ ...request, body: "", note: `通信失敗：${p.errorText}` });
      } else if (method === "Network.loadingFinished") {
        const request = item.pending.get(p.requestId);
        item.pending.delete(p.requestId);
        if (!request) return;
        if (p.encodedDataLength > MAX_BODY) {
          save({
            ...request,
            body: "",
            note: "サイズ上限のため本文を取得しませんでした。",
            truncated: true,
          });
          return;
        }
        if (
          request.contentType &&
          !/(?:json|text\/|xml|javascript)/i.test(request.contentType)
        )
          return;
        try {
          const result = await contents.debugger.sendCommand(
            "Network.getResponseBody",
            { requestId: p.requestId },
          );
          if (!recording || run !== generation) return;
          const body = result.base64Encoded
            ? Buffer.from(result.body, "base64").toString("utf8")
            : result.body;
          save({ ...request, body, note: "" });
        } catch {
          if (recording && run === generation)
            save({
              ...request,
              body: "",
              note: "本文を取得できませんでした（キャッシュ破棄・画面遷移など）。",
            });
        }
      }
    };
    contents.debugger.on("message", message);
    contents.debugger.on("detach", () => {
      item.active = false;
      item.owned = false;
      item.pending.clear();
      if (recording && !contents.isDestroyed())
        item.error = "デバッグ接続が切断され、このタブの記録は停止しました。";
      changed();
    });
    contents.on("devtools-closed", () => {
      if (recording && !item.active) attach(item);
    });
    contents.once("destroyed", () => {
      tracked.delete(contents.id);
      changed();
    });
    if (recording) attach(item);
  }
  return {
    track,
    store,
    async setRecording(value) {
      if (typeof value !== "boolean") throw new Error("記録の設定が不正です。");
      recording = value;
      generation++;
      if (value) await Promise.allSettled([...tracked.values()].map(attach));
      else
        for (const item of tracked.values()) {
          item.active = false;
          item.pending.clear();
          if (item.owned && !item.contents.isDestroyed()) {
            try {
              item.contents.debugger.detach();
            } catch {}
          }
          item.owned = false;
          item.error = "";
        }
      publish();
    },
    status: () => ({
      recording,
      ...store.stats(),
      targets: [...tracked.values()]
        .map((i) => ({
          ...describe(i.contents),
          sessionId: i.sessionId,
          active: i.active,
          error: i.error,
        }))
        .filter((t) => t.error),
    }),
    apiResult(t, result, createdAt) {
      if (!recording || result.binary) return;
      save({
        kind: "api",
        tabId: t.id,
        contentsId: t.view.webContents.id,
        sessionId: t.sessionId,
        title: t.title,
        url: result.url,
        method: result.method,
        status: result.status,
        createdAt,
        body: result.body,
        truncated: result.truncated,
        note: result.truncated ? "API応答の表示上限を超えています。" : "",
      });
    },
    clear(sessionId) {
      generation++;
      store.clear(sessionId);
      for (const item of tracked.values()) item.pending.clear();
      publish();
    },
    stop: () => {
      recording = false;
      clearTimeout(notification);
      for (const item of tracked.values())
        if (item.owned && !item.contents.isDestroyed()) {
          try {
            item.contents.debugger.detach();
          } catch {}
        }
    },
  };
}
module.exports = { createNetworkCapture };
