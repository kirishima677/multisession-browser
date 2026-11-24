const { randomUUID } = require("node:crypto");
const MAX_BODY = 1024 * 1024,
  MAX_TOTAL = 20 * 1024 * 1024,
  MAX_RECORDS = 300;
function responseText(value, limit = MAX_BODY) {
  let text = String(value);
  try {
    text = JSON.stringify(JSON.parse(text), null, 2);
  } catch {}
  const buffer = Buffer.from(text);
  return {
    text: buffer.subarray(0, limit).toString("utf8"),
    truncated: buffer.length > limit,
  };
}
function createResponseStore({
  maxBody = MAX_BODY,
  maxTotal = MAX_TOTAL,
  maxRecords = MAX_RECORDS,
} = {}) {
  let records = [],
    bytes = 0,
    evicted = 0;
  return {
    add(input) {
      const body = responseText(input.body || "", maxBody),
        record = {
          ...input,
          id: randomUUID(),
          body: body.text,
          truncated: Boolean(input.truncated || body.truncated),
        };
      record.bytes = Buffer.byteLength(record.body);
      records.push(record);
      bytes += record.bytes;
      while (records.length > maxRecords || bytes > maxTotal) {
        bytes -= records.shift().bytes;
        evicted++;
      }
      return record.id;
    },
    stats: () => ({
      count: records.length,
      bytes,
      evicted,
      maxBody,
      maxTotal,
      maxRecords,
    }),
    clear(sessionId) {
      records = sessionId
        ? records.filter((r) => r.sessionId !== sessionId)
        : [];
      bytes = records.reduce((n, r) => n + r.bytes, 0);
      if (!sessionId) evicted = 0;
    },
    get: (id) => records.find((r) => r.id === id),
    search({ query = "", sessionId = "", tabId = "" } = {}) {
      if (typeof query !== "string" || query.length > 512)
        throw new Error("検索文字列は512文字以内で指定してください。");
      const needle = query.toLocaleLowerCase(),
        results = [];
      let total = 0;
      for (const record of [...records].reverse()) {
        if (
          (sessionId && record.sessionId !== sessionId) ||
          (tabId && record.tabId !== tabId)
        )
          continue;
        const haystack = record.body.toLocaleLowerCase(),
          index = needle ? haystack.indexOf(needle) : 0;
        if (index < 0) continue;
        total++;
        if (results.length >= 100) continue;
        const { body, ...meta } = record;
        const from = Math.max(0, index - 90),
          to = Math.min(body.length, index + Math.max(needle.length, 120));
        results.push({
          ...meta,
          match: needle ? index : -1,
          snippet: body.slice(from, to),
          snippetStart: from,
        });
      }
      return { results, total, limited: total > results.length };
    },
  };
}
module.exports = {
  createResponseStore,
  responseText,
  MAX_BODY,
  MAX_TOTAL,
  MAX_RECORDS,
};
