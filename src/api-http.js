const { net } = require("electron");
const { performance } = require("node:perf_hooks");
const { MAX_RESPONSE, prepare } = require("./api-request");

function execute(session, input, signal) {
  const requestData = prepare(input);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    let request,
      timer,
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else
        resolve({
          ...result,
          url: requestData.url,
          method: requestData.method,
          durationMs: Math.round(performance.now() - started),
        });
    };
    const stop = (message) => {
      const error = new Error(message);
      finish(error);
      request?.abort();
    };
    const abort = () => stop("リクエストをキャンセルしました。");
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      request = net.request({
        session,
        url: requestData.url,
        method: requestData.method,
        credentials: requestData.credentials,
        redirect: "manual",
      });
      for (const [name, value] of requestData.headers)
        request.setHeader(name, value);
      request.on("error", (error) =>
        finish(new Error(`通信できませんでした：${error.message}`)),
      );
      request.on("login", (_auth, callback) => callback());
      request.on(
        "redirect",
        (statusCode, _method, redirectURL, responseHeaders) => {
          finish(null, {
            status: statusCode,
            statusText: "Redirect",
            headers: responseHeaders,
            body: "",
            bytes: 0,
            truncated: false,
            binary: false,
            redirectURL,
          });
          request.abort();
        },
      );
      request.on("response", (response) => {
        const chunks = [];
        let bytes = 0;
        const result = (truncated) => {
          const buffer = Buffer.concat(chunks);
          const contentType = String(response.headers["content-type"] || "");
          const binary =
            Boolean(contentType) &&
            !/(?:json|text\/|xml|javascript|x-www-form-urlencoded)/i.test(
              contentType,
            );
          return {
            status: response.statusCode,
            statusText: response.statusMessage || "",
            headers: response.headers,
            body: binary ? "" : new TextDecoder().decode(buffer),
            bytes,
            binary,
            truncated,
          };
        };
        response.on("data", (chunk) => {
          if (settled) return;
          const remaining = MAX_RESPONSE - bytes;
          chunks.push(chunk.subarray(0, remaining));
          bytes += Math.min(remaining, chunk.length);
          if (chunk.length > remaining) {
            finish(null, result(true));
            request.abort();
          }
        });
        response.on("end", () => finish(null, result(false)));
        response.on("error", (error) =>
          finish(new Error(`受信できませんでした：${error.message}`)),
        );
        response.on("aborted", () =>
          finish(new Error("応答の受信が中断されました。")),
        );
      });
      timer = setTimeout(
        () =>
          stop(`タイムアウトしました（${requestData.timeoutMs / 1000}秒）。`),
        requestData.timeoutMs,
      );
      if (requestData.body !== undefined) request.write(requestData.body);
      request.end();
    } catch (error) {
      finish(error);
      request?.abort();
    }
  });
}
module.exports = { execute };
