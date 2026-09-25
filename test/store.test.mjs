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
  assert.equal(store.state.version, 6);
  assert.equal(store.state.projects[0].videos[0].id, "vid_a");
  assert.equal(store.state.projects[0].format.aspect, "source");
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

test("v3 projects gain the default output format", async () => {
  const { file } = await tmpFile(JSON.stringify({
    version: 3, projects: [{ id: "p", name: "P", videos: [] }], presets: [], collections: [],
  }));
  const store = new Store(file);
  await store.load();
  assert.equal(store.state.projects[0].format.aspect, "source");
});

test("v4 keeps the format a project had, and drops its sequence", async () => {
  const { file } = await tmpFile(JSON.stringify({
    version: 4,
    projects: [{
      id: "p", name: "P", videos: [],
      sequence: { format: { aspect: "9:16", size: 1080 }, shots: [{ id: "sh", videoId: "v" }] },
    }],
    presets: [], collections: [],
  }));
  const store = new Store(file);
  await store.load();
  const project = store.state.projects[0];
  assert.equal(project.format.aspect, "9:16");
  assert.equal(project.format.size, 1080);
  assert.equal(project.sequence, undefined);
});

test("v5 projects gain the default brand kit on migration", async () => {
  const { file } = await tmpFile(JSON.stringify({
    version: 5, projects: [{ id: "p", name: "P", videos: [], format: { aspect: "9:16" } }],
  }));
  const store = new Store(file);
  await store.load();
  assert.equal(store.state.projects[0].brandId, null);
  assert.deepEqual(store.state.brands, []);
  assert.equal(store.brandOf(store.project("p")).name, "Studio (par défaut)");
});

test("a brand kit keeps only valid colours and fonts, and its projects survive its deletion", async () => {
  const { file } = await tmpFile();
  const store = new Store(file);
  await store.load();
  const brand = store.addBrand("Client A");
  store.updateBrand(brand.id, {
    colors: { primary: "#FF0055", text: "not a colour" },
    fonts: { title: "Futura", body: "file:../../../etc/passwd" },
  });
  assert.equal(brand.colors.primary, "#ff0055");
  assert.equal(brand.colors.text, "#ffffff");
  assert.equal(brand.fonts.title, "Futura");
  assert.equal(brand.fonts.body, "system");

  const project = store.activeProject();
  project.brandId = brand.id;
  assert.equal(store.snapshot([]).brand.name, "Client A");
  store.removeBrand(brand.id);
  assert.equal(project.brandId, null);
  assert.equal(store.snapshot([]).brand.name, "Studio (par défaut)");
});
