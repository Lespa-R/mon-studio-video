// Smoke test of the interface: start a throwaway copy of the studio, open it in
// a headless Chrome, visit every tab, and fail on any script error.
//
// No dependency: Chrome comes from the promos workspace (Remotion downloads
// chrome-headless-shell) or CHROME=…; without one the test is skipped. The
// studio runs from a temp copy (its own studio.json, media/) on a free port,
// with an empty promos workspace — Robin's studio and files are never touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findChrome() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  const base = path.join(os.homedir(), "Code", "promos", "node_modules", ".remotion");
  try {
    return execFileSync("find", [base, "-name", "chrome-headless-shell", "-type", "f", "-perm", "+111"], { encoding: "utf8" })
      .split("\n").find(Boolean) || null;
  } catch { return null; }
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return r; } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error(`${url} ne répond pas`);
}

const chrome = findChrome();

test("every tab of the interface loads without a script error", { skip: !chrome && "pas de Chrome sans interface (installe Remotion dans ~/Code/promos, ou CHROME=…)", timeout: 90000 }, async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "studio-ui-"));
  const procs = [];
  try {
    for (const dir of ["server", "lib", "bin", "tools"]) await fsp.cp(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
    await fsp.copyFile(path.join(ROOT, "package.json"), path.join(tmp, "package.json"));
    // One promo, so the Promos tab draws its editor and side panel too.
    await fsp.mkdir(path.join(tmp, "promos", "demo", "public", "brand"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "promos", "demo", "storyboard.json"), JSON.stringify({
      title: "Démo", url: "https://example.com", formats: ["4:5"], music: { mode: "generate", mood: "electro", bpm: 120 },
      invented: ["un chiffre"], scenes: [
        { type: "stamps", bars: 2, energy: "intro", props: { words: ["Une idée.", "*En ligne.*"] } },
        { type: "counters", bars: 2, energy: "drop", props: { title: "En **chiffres**", items: [["12", "projets"]] } },
        { type: "finale", bars: 2, energy: "finale", props: { headline: "Démo", url: "example.com" } },
      ],
    }));

    const port = await freePort();
    const server = spawn(process.execPath, ["server/server.mjs", String(port)], {
      cwd: tmp, env: { ...process.env, PROMOS_DIR: path.join(tmp, "promos"), STUDIO_NO_OPEN: "1" }, stdio: "ignore",
    });
    procs.push(server);
    // The server may move to the next port if this one got taken meanwhile.
    let base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/api/state`).catch(async () => {
      const p = Number(await fsp.readFile(path.join(tmp, ".studio-port"), "utf8"));
      base = `http://127.0.0.1:${p}`;
      await waitFor(`${base}/api/state`);
    });

    const cdpPort = await freePort();
    const browser = spawn(chrome, ["--headless", "--disable-gpu", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(tmp, "chrome")}`, "about:blank"], { stdio: "ignore" });
    procs.push(browser);
    let targets = null;
    for (let i = 0; i < 50 && !targets; i++) {
      await sleep(200);
      targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((r) => r.json()).catch(() => null);
    }
    assert.ok(targets, "Chrome ne répond pas");
    const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
      if (d.method === "Runtime.exceptionThrown") {
        const e = d.params.exceptionDetails;
        errors.push(`${e.exception?.description || e.text} (${e.url || ""}:${e.lineNumber})`);
      }
      if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
        errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
      }
      if (d.method === "Log.entryAdded" && d.params.entry.level === "error" && !/favicon/.test(d.params.entry.url || "")) {
        errors.push(`${d.params.entry.text} ${d.params.entry.url || ""}`);
      }
    };
    const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;

    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: `${base}/` });
    await sleep(2500);
    const tabs = await evaluate(`[...document.querySelectorAll("button[id^=tab-]")].map((b) => b.id)`);
    assert.ok(tabs?.length >= 4, `onglets introuvables (${tabs})`);
    const seen = {};
    for (const tab of tabs) {
      await evaluate(`document.getElementById(${JSON.stringify(tab)}).click()`);
      await sleep(900);
      seen[tab] = await evaluate(`[...document.querySelectorAll("main")].filter((m) => !m.hidden).map((m) => m.id + ":" + m.innerText.trim().length).join(",")`);
    }
    // The Promos tab: editor, side panel and the post draft (served by the skill's package.py).
    await evaluate(`document.getElementById("tab-promos").click()`);
    await sleep(1500);
    const promosView = await evaluate(`({ scenes: document.querySelectorAll("#promo-editor .pr-scene").length,
      post: document.querySelector("#promo-side .pr-post") ? true : false })`);
    assert.deepEqual(promosView, { scenes: 3, post: true }, "onglet Promos incomplet");
    await evaluate(`document.getElementById("tab-edit").click()`);
    await sleep(500);
    ws.close();

    assert.deepEqual(errors, [], `erreurs dans l'interface :\n${errors.join("\n")}`);
    for (const [tab, shown] of Object.entries(seen)) assert.ok(shown && !/:0$/.test(shown), `${tab} : vue vide (${shown})`);
  } finally {
    for (const p of procs) try { p.kill("SIGKILL"); } catch { /* gone */ }
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
