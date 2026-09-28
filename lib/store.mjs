// The studio's persistent state: folders → projects → videos → effects,
// plus a library of user-made effect presets.
//
// One JSON file, loaded once and written back on every mutation. Small enough
// that anything cleverer would be premature.

import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { DEFAULT_FORMAT, normaliseFormat } from "./format.mjs";
import { DEFAULT_BRAND, normaliseBrand, FONT_FILE } from "./brand.mjs";

export const newId = (prefix) => `${prefix}${crypto.randomBytes(4).toString("hex")}`;

const EMPTY = () => ({
  version: 6,
  folders: [],
  projects: [],
  // The effect library: presets, grouped into collections.
  collections: [],
  presets: [],
  // Brand kits (chartes graphiques); a project points at one with brandId.
  brands: [],
  // Fonts imported for brand kits: { file, name, addedAt }.
  fonts: [],
  activeProject: null,
  activeVideo: null,
});

// Every project has an output format (see lib/format.mjs). v4 stored it in a
// `sequence` alongside shots; that feature was dropped, the format kept.
// v6 added the brand kit a project uses (null = the studio default).
function withFormat(project) {
  const { sequence, ...rest } = project;
  return {
    ...rest,
    format: normaliseFormat(project.format || sequence?.format || DEFAULT_FORMAT),
    brandId: project.brandId ?? null,
  };
}

// v1 kept a flat `videos` array at the root. Wrap it in a project so nothing
// the user already set up is lost.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return EMPTY();
  if (raw.version >= 2) {
    const state = { ...EMPTY(), ...raw, version: 6 };
    // v5 had no brand kits.
    state.brands = (state.brands || []).map((b) => normaliseBrand(b));
    state.fonts = (state.fonts || []).filter((f) => FONT_FILE.test(String(f?.file)));
    // v2 presets had no collection.
    state.presets = state.presets.map((p) => ({ collectionId: null, ...p }));
    // v3 projects had no format; v4 kept it inside a `sequence`, now gone.
    state.projects = state.projects.map(withFormat);
    return state;
  }
  const state = EMPTY();
  if (Array.isArray(raw.videos) && raw.videos.length) {
    const project = withFormat({ id: newId("prj_"), name: "Projet 1", folderId: null, videos: raw.videos });
    state.projects.push(project);
    state.activeProject = project.id;
    state.activeVideo = raw.activeVideo || null;
  }
  return state;
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = EMPTY();
    this.queue = Promise.resolve();
  }

  // Never overwrite a file we could not read. A truncated studio.json (a crash
  // mid-write, a bad manual edit) is moved aside, and the last copy that did
  // load is restored in its place. `this.recovery` tells the caller what
  // happened so it can say so loudly.
  async load() {
    this.recovery = null;
    const backup = this.file.replace(/\.json$/, ".backup.json");

    let raw = null;
    try {
      raw = await fsp.readFile(this.file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error; // unreadable ≠ absent: stop here
    }

    if (raw === null) {
      this.state = EMPTY();
    } else {
      try {
        this.state = migrate(JSON.parse(raw));
        // Remember the last state that loaded cleanly.
        await fsp.writeFile(backup, raw);
      } catch {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const quarantined = this.file.replace(/\.json$/, `.corrupt-${stamp}.json`);
        await fsp.rename(this.file, quarantined);

        let restored = false;
        try {
          this.state = migrate(JSON.parse(await fsp.readFile(backup, "utf8")));
          restored = true;
        } catch {
          this.state = EMPTY();
        }
        this.recovery = { quarantined, restored, backup };
      }
    }
    if (!this.state.projects.length) {
      const project = withFormat({ id: newId("prj_"), name: "Projet 1", folderId: null, videos: [] });
      this.state.projects.push(project);
      this.state.activeProject = project.id;
    }
    if (!this.project(this.state.activeProject)) {
      this.state.activeProject = this.state.projects[0].id;
    }
    await this.save();
    return this.state;
  }

  // Write to a sibling file, then rename over the real one. rename() is atomic
  // on a single filesystem, so a crash leaves either the old file or the new
  // one — never half of each.
  //
  // Saves are chained so two never interleave. A failed write (disk full, file
  // locked) must not poison the chain: the next save still runs and, since it
  // writes the whole state, repairs the file. Callers get their own failure.
  save() {
    const run = this.queue.catch(() => {}).then(async () => {
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(this.state, null, 2));
      await fsp.rename(tmp, this.file);
    });
    this.queue = run;
    return run;
  }

  // ------------------------------------------------------------- lookups

  project(id) {
    return this.state.projects.find((p) => p.id === id) || null;
  }

  folder(id) {
    return this.state.folders.find((f) => f.id === id) || null;
  }

  // Video ids are unique across the whole store, so a lookup does not need to
  // know which project it belongs to.
  locate(videoId) {
    for (const project of this.state.projects) {
      const video = project.videos.find((v) => v.id === videoId);
      if (video) return { project, video };
    }
    return { project: null, video: null };
  }

  video(videoId) {
    return this.locate(videoId).video;
  }

  activeProject() {
    return this.project(this.state.activeProject) || this.state.projects[0] || null;
  }

  // ------------------------------------------------------------ mutations

  addFolder(name) {
    const folder = { id: newId("fld_"), name: name || "Nouveau dossier" };
    this.state.folders.push(folder);
    return folder;
  }

  removeFolder(id) {
    this.state.folders = this.state.folders.filter((f) => f.id !== id);
    // Projects survive their folder; they just go back to the root.
    for (const p of this.state.projects) if (p.folderId === id) p.folderId = null;
  }

  addProject(name, folderId = null) {
    const project = withFormat({
      id: newId("prj_"),
      name: name || "Nouveau projet",
      folderId: this.folder(folderId) ? folderId : null,
      videos: [],
    });
    this.state.projects.push(project);
    return project;
  }

  // Returns the media files that are now orphaned so the caller can delete
  // them — the store itself never touches the filesystem.
  removeProject(id) {
    const project = this.project(id);
    if (!project) return [];
    const videos = project.videos;
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    if (!this.state.projects.length) {
      const fresh = this.addProject("Projet 1");
      this.state.activeProject = fresh.id;
    } else if (this.state.activeProject === id) {
      this.state.activeProject = this.state.projects[0].id;
    }
    return videos;
  }

  addPreset({ name, type, params, collectionId = null }) {
    const preset = {
      id: newId("pre_"),
      name: name || "Sans nom",
      type,
      params,
      collectionId: this.collection(collectionId) ? collectionId : null,
      createdAt: new Date().toISOString(),
    };
    this.state.presets.push(preset);
    return preset;
  }

  duplicatePreset(id) {
    const source = this.preset(id);
    if (!source) return null;
    const copy = this.addPreset({
      name: `${source.name} (copie)`,
      type: source.type,
      params: { ...source.params },
      collectionId: source.collectionId,
    });
    // Keep the copy next to its original rather than at the end of the list.
    this.state.presets.pop();
    const at = this.state.presets.findIndex((p) => p.id === id);
    this.state.presets.splice(at + 1, 0, copy);
    return copy;
  }

  collection(id) {
    return this.state.collections.find((c) => c.id === id) || null;
  }

  addCollection(name) {
    const collection = { id: newId("col_"), name: name || "Nouvelle collection" };
    this.state.collections.push(collection);
    return collection;
  }

  removeCollection(id) {
    this.state.collections = this.state.collections.filter((c) => c.id !== id);
    // Presets survive; they go back to the ungrouped list.
    for (const p of this.state.presets) if (p.collectionId === id) p.collectionId = null;
  }

  // --------------------------------------------------------- brand kits

  brand(id) {
    return this.state.brands.find((b) => b.id === id) || null;
  }

  // The kit a project renders with: its own, or the studio default.
  brandOf(project) {
    return (project && this.brand(project.brandId)) || DEFAULT_BRAND;
  }

  addBrand(name, from = null) {
    const source = this.brand(from) || DEFAULT_BRAND;
    const brand = normaliseBrand({ ...source, id: newId("brd_"), name: name || "Ma charte" });
    this.state.brands.push(brand);
    return brand;
  }

  updateBrand(id, patch) {
    const brand = this.brand(id);
    if (!brand) return null;
    const next = normaliseBrand({
      ...brand,
      ...patch,
      id,
      colors: { ...brand.colors, ...(patch.colors || {}) },
      fonts: { ...brand.fonts, ...(patch.fonts || {}) },
    });
    Object.assign(brand, next);
    return brand;
  }

  removeBrand(id) {
    this.state.brands = this.state.brands.filter((b) => b.id !== id);
    // Projects that used it fall back to the default kit.
    for (const p of this.state.projects) if (p.brandId === id) p.brandId = null;
  }

  removePreset(id) {
    this.state.presets = this.state.presets.filter((p) => p.id !== id);
  }

  preset(id) {
    return this.state.presets.find((p) => p.id === id) || null;
  }

  // What the UI needs in one call.
  // `projectId` is the project the asking tab has open. The stored
  // activeProject is only the default for a tab that has not chosen yet — it
  // is shared by every tab, so it must never decide what an open tab shows.
  snapshot(catalogue, projectId = null) {
    const project = this.project(projectId) || this.activeProject();
    return {
      folders: this.state.folders,
      projects: this.state.projects.map(({ id, name, folderId, videos, brandId }) => ({
        id, name, folderId, brandId, videoCount: videos.length,
      })),
      presets: this.state.presets,
      collections: this.state.collections,
      brands: this.state.brands,
      fonts: this.state.fonts,
      brandId: project ? project.brandId : null,
      // The kit this project renders with, resolved — the UI paints its swatches from it.
      brand: this.brandOf(project),
      activeProject: project ? project.id : null,
      activeProjectName: project ? project.name : null,
      videos: project ? project.videos : [],
      format: project ? project.format : null,
      activeVideo: this.state.activeVideo,
      effects: catalogue,
    };
  }
}
