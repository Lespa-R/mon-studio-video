import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../lib/store.mjs";

async function tmpFile(contents) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-test-"));
  const file = path.join(dir, "studio.json");
  if (contents !== undefined) await fs.writeFile(file, contents);
  return { dir, file };
}

test("a missing file starts a fresh library with one project", async () => {
  const { file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  assert.equal(store.state.projects.length, 1);
  assert.equal(store.recovery, null);
});

test("v1 — a flat list of clips — is wrapped in a project, nothing lost", async () => {
  const { file } = await tmpFile(JSON.stringify({ videos: [{ id: "vid_a", effects: [] }] }));
  const store = new Store(file);
  await store.load();
  assert.equal(store.state.version, 3);
  assert.equal(store.state.projects[0].videos[0].id, "vid_a");
});

test("v2 presets gain an empty collection on migration", async () => {
  const { file } = await tmpFile(JSON.stringify({
    version: 2, projects: [{ id: "p", name: "P", videos: [] }],
    presets: [{ id: "pre_a", name: "A", type: "title", params: {} }],
  }));
  const store = new Store(file);
  await store.load();
  assert.equal(store.state.presets[0].collectionId, null);
});

test("saving leaves a valid file and no temporary behind", async () => {
  const { dir, file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  store.addFolder("Clients");
  await store.save();
  JSON.parse(await fs.readFile(file, "utf8"));
  assert.ok(!(await fs.readdir(dir)).some((f) => f.endsWith(".tmp")));
});

test("a corrupt file is quarantined and the last good copy restored", async () => {
  const { dir, file } = await tmpFile();
  const first = new Store(file);
  await first.load();
  first.state.projects[0].name = "Mon gros projet";
  await first.save();
  await new Store(file).load(); // a clean start takes the backup

  await fs.writeFile(file, '{"version":3,"projects":[{"na'); // crash mid-write
  const store = new Store(file);
  await store.load();

  assert.equal(store.state.projects[0].name, "Mon gros projet");
  assert.equal(store.recovery.restored, true);
  const files = await fs.readdir(dir);
  assert.ok(files.some((f) => f.startsWith("studio.corrupt-")), "the corrupt file is kept");
});

test("a corrupt file with no backup is still kept, never overwritten", async () => {
  const { dir, file } = await tmpFile('{"truncated": ');
  const store = new Store(file);
  await store.load();
  assert.equal(store.recovery.restored, false);
  const kept = (await fs.readdir(dir)).find((f) => f.startsWith("studio.corrupt-"));
  assert.equal(await fs.readFile(path.join(dir, kept), "utf8"), '{"truncated": ');
});

test("deleting a folder keeps its projects, moved to the root", async () => {
  const { file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  const folder = store.addFolder("F");
  const project = store.addProject("P", folder.id);
  store.removeFolder(folder.id);
  assert.equal(store.project(project.id).folderId, null);
});

test("deleting a project hands back its clips so their media can be removed", async () => {
  const { file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  const project = store.addProject("P");
  project.videos.push({ id: "vid_x" });
  assert.deepEqual(store.removeProject(project.id).map((v) => v.id), ["vid_x"]);
});

test("deleting the last project leaves a fresh one rather than nothing", async () => {
  const { file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  store.removeProject(store.state.projects[0].id);
  assert.equal(store.state.projects.length, 1);
  assert.ok(store.project(store.state.activeProject));
});

test("a duplicated preset sits right after its original, same collection", async () => {
  const { file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  const col = store.addCollection("C");
  const a = store.addPreset({ name: "A", type: "title", params: { x: 1 }, collectionId: col.id });
  store.addPreset({ name: "B", type: "title", params: {} });
  const copy = store.duplicatePreset(a.id);
  assert.deepEqual(store.state.presets.map((p) => p.name), ["A", "A (copie)", "B"]);
  assert.equal(copy.collectionId, col.id);
  copy.params.x = 2;
  assert.equal(a.params.x, 1, "the copy's params are its own");
});

test("deleting a collection keeps its presets", async () => {
  const { file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  const col = store.addCollection("C");
  const p = store.addPreset({ name: "A", type: "title", params: {}, collectionId: col.id });
  store.removeCollection(col.id);
  assert.equal(store.preset(p.id).collectionId, null);
});
