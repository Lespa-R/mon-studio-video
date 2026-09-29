// Storage page: what the studio's files weigh, and deleting what may go.
//
// lib/storage.mjs (pure) sorts every file into a kind and says whether it may
// be deleted; this module lists the folders, deletes, and shows a file in the
// Finder. Deletion takes names, never paths, and trusts only a fresh scan.

import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { classify, KINDS } from "../lib/storage.mjs";

async function sizeOf(target) {
  const st = await fsp.stat(target);
  if (!st.isDirectory()) return { size: st.size, mtime: st.mtimeMs };
  let size = 0;
  let mtime = st.mtimeMs;
  for (const entry of await fsp.readdir(target)) {
    const inner = await sizeOf(path.join(target, entry));
    size += inner.size;
    mtime = Math.max(mtime, inner.mtime);
  }
  return { size, mtime };
}

async function listDir(dir, filter = () => true) {
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const name of names.filter((n) => !n.startsWith(".") && filter(n))) {
    try { out.push({ name, ...(await sizeOf(path.join(dir, name))) }); } catch { /* vanished */ }
  }
  return out;
}

/**
 * busy(videoId)  → true while a matte / tracking / trim job uses that clip's files
 * forget(item)   → drop what the studio remembers about a deleted file (matte
 *                  signature, people cache, trim state, font entry)
 */
export function makeStorage({ ROOT, MEDIA, RENDERS, store, promos, send, readJson, busy, forget, saveState }) {
  const CACHE = path.join(ROOT, ".transcode-cache");
  const areaDir = { media: MEDIA, renders: RENDERS, root: ROOT, cache: CACHE };

  async function scan() {
    const [mediaFiles, renderFiles, rootFiles, cacheFiles] = await Promise.all([
      listDir(MEDIA),
      listDir(RENDERS),
      listDir(ROOT, (n) => /^studio.*\.json(\.tmp)?$|^render-.*\.html$/.test(n)),
      listDir(CACHE),
    ]);
    const result = classify({ media: mediaFiles, renders: renderFiles, root: rootFiles, cache: cacheFiles }, store.state);
    let disk = null;
    try {
      const st = await fsp.statfs(ROOT);
      disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
    } catch { /* older Node */ }
    return { ...result, disk, kinds: KINDS, folder: ROOT, promos: await promos().usage() };
  }

  async function remove(targets) {
    const { items } = await scan();
    let freed = 0;
    const skipped = [];
    for (const t of Array.isArray(targets) ? targets : []) {
      // Only what the scan itself calls deletable — never a path from the page.
      const it = items.find((x) => x.area === t?.area && x.name === t?.name);
      if (!it || !it.deletable) { skipped.push(t?.name); continue; }
      if (it.videoId && busy(it.videoId)) { skipped.push(it.name); continue; }
      await fsp.rm(path.join(areaDir[it.area], it.name), { recursive: true, force: true });
      freed += it.size;
      forget(it);
    }
    await saveState();
    return { freed, skipped };
  }

  async function handleApi(req, res, id) {
    if (req.method === "GET" && !id) return send(res, 200, await scan());
    if (req.method === "POST" && id === "delete") {
      const { targets } = await readJson(req);
      return send(res, 200, await remove(targets));
    }
    // Show a file in the Finder, to move a render somewhere else.
    if (req.method === "POST" && id === "reveal") {
      const { area, name } = await readJson(req);
      const { items } = await scan();
      const it = items.find((x) => x.area === area && x.name === name);
      if (!it) return send(res, 404, { error: "fichier introuvable" });
      spawn("open", ["-R", path.join(areaDir[it.area], it.name)], { stdio: "ignore" });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  }

  return { scan, remove, handleApi };
}
