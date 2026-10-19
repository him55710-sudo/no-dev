// Test-only transport: preserve the real Stripe SDK and redirect its two GET
// pricing endpoints to the disposable fixture. Never loaded by the shipped app.
const http = require("node:http");
const https = require("node:https");
const { syncBuiltinESMExports } = require("node:module");
const port = Number(process.env.PUREOBOM_BUILD_STRIPE_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Missing local build pricing fixture");
const original = https.request;
https.request = function (options, ...rest) {
  const host = options?.hostname || options?.host;
  if (host !== "api.stripe.com") return original.call(this, options, ...rest);
  const path = new URL(options.path, "https://api.stripe.com").pathname;
  if (
    options.method !== "GET" ||
    !["/v1/prices", "/v1/products"].includes(path)
  )
    throw Error("Unexpected Stripe operation in production-build fixture");
  const request = http.request(
    {
      ...options,
      host: "127.0.0.1",
      hostname: "127.0.0.1",
      port,
      protocol: "http:",
      agent: false,
    },
    ...rest,
  );
  // NodeHttpClient waits for secureConnect before ending an HTTPS request.
  // This loopback HTTP socket has no TLS; adapt only the fixture's event.
  request.on("socket", (socket) => {
    if (socket.connecting)
      socket.once("connect", () => socket.emit("secureConnect"));
  });
  return request;
};
syncBuiltinESMExports();
