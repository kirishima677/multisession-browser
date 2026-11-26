function sampleJWT(claims) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    Buffer.from("synthetic-test-signature").toString("base64url"),
  ].join(".");
}

module.exports = { sampleJWT };
