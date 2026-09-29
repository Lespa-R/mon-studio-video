// Preloaded into Remotion Studio (NODE_OPTIONS=--require) by « Aperçu interactif ».
// Remotion binds its preview server to every interface (0.0.0.0 / ::), which
// would expose the promo — and Remotion's file-writing endpoints — to the
// local network. The studio is loopback-only; so is its preview.
const net = require("node:net");
const listen = net.Server.prototype.listen;
const OPEN = new Set(["0.0.0.0", "::", "", undefined, null]);
net.Server.prototype.listen = function (...args) {
  const [first] = args;
  if (first && typeof first === "object" && !Array.isArray(first) && "port" in first && OPEN.has(first.host)) {
    args[0] = { ...first, host: "127.0.0.1", ipv6Only: false };
  } else if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    if (typeof args[1] !== "string" || OPEN.has(args[1])) {
      args.splice(1, typeof args[1] === "string" ? 1 : 0, "127.0.0.1");
    }
  }
  return listen.apply(this, args);
};
