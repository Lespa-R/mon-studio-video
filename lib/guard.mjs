// Who may talk to the studio.
//
// The studio drives ffmpeg, writes to disk and deletes media, so only its own
// page may reach it.
//
// Host: a page on another domain can rebind its DNS to 127.0.0.1 and reach us
// under its own hostname; a Host we do not recognise is refused outright.
// Origin: browsers attach it to every cross-site request, including the
// "simple" POSTs that skip the CORS preflight. Absent (curl, the CLI) is fine —
// the socket only listens on loopback, so that is a local process.

export function makeGuard(port) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  // Returns why the request is refused, or null when it may proceed.
  return function refused(headers) {
    if (!hosts.has(String(headers.host || "").toLowerCase())) return "hôte non autorisé";
    const origin = headers.origin;
    if (origin !== undefined && !origins.has(String(origin).toLowerCase())) {
      return "origine non autorisée";
    }
    return null;
  };
}
