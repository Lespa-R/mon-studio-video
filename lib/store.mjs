// The studio's persistent state: folders → projects → videos → effects,
// plus a library of user-made effect presets.
//
// One JSON file, loaded once and written back on every mutation. Small enough
// that anything cleverer would be premature.

import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { DEFAULT_FORMAT, normaliseFormat } from "./format.mjs";

export const newId = (prefix) => `${prefix}${crypto.randomBytes(4).toString("hex")}`;

const EMPTY = () => ({
  version: 4,
  folders: [],
  projects: [],
  // The effect library: presets, grouped into collections.
  collections: [],
  presets: [],
  activeProject: null,
  activeVideo: null,
});

// A project's sequence: the output format, and the shots played one after the
// other. A shot points at one of the project's clips, trimmed to [in, out].
export const emptySequence = () => ({ format: { ...DEFAULT_FORMAT }, shots: [] });

function withSequence(project) {
  const sequence = project.sequence || emptySequence();
  return {
    ...project,
    sequence: {
      format: normaliseFormat(sequence.format),
      shots: Array.isArray(sequence.shots) ? sequence.shots : [],
    },
  };
}

// v1 kept a flat `videos` array at the root. Wrap it in a project so nothing
// the user already set up is lost.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return EMPTY();
  if (raw.version >= 2) {
    const state = { ...EMPTY(), ...raw, version: 4 };
    // v2 presets had no collection.
    state.presets = state.presets.map((p) => ({ collectionId: null, ...p }));
    // v3 projects had no sequence.
    state.projects = state.projects.map(withSequence);
    return state;
  }
  const state = EMPTY();
  if (Array.isArray(raw.videos) && raw.videos.length) {
    const project = withSequence({ id: newId("prj_"), name: "Projet 1", folderId: null, videos: raw.videos });
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
      const project = withSequence({ id: newId("prj_"), name: "Projet 1", folderId: null, videos: [] });
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
  save() {
    this.queue = this.queue.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(this.state, null, 2));
      await fsp.rename(tmp, this.file);
    });
    return this.queue;
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
    const project = withSequence({
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

  // ------------------------------------------------------------- shots

  addShot(project, videoId, { in: cutIn = 0, out = null } = {}) {
    if (!project.videos.some((v) => v.id === videoId)) return null;
    const shot = { id: newId("sh_"), videoId, in: cutIn, out, transition: "cut" };
    project.sequence.shots.push(shot);
    return shot;
  }

  moveShot(project, shotId, index) {
    const shots = project.sequence.shots;
    const from = shots.findIndex((s) => s.id === shotId);
    if (from < 0) return;
    const [shot] = shots.splice(from, 1);
    shots.splice(Math.max(0, Math.min(index, shots.length)), 0, shot);
  }

  removeShot(project, shotId) {
    project.sequence.shots = project.sequence.shots.filter((s) => s.id !== shotId);
  }

  // A clip leaving the project takes its shots with it.
  forgetClip(project, videoId) {
    project.sequence.shots = project.sequence.shots.filter((s) => s.videoId !== videoId);
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

  removePreset(id) {
    this.state.presets = this.state.presets.filter((p) => p.id !== id);
  }

  preset(id) {
    return this.state.presets.find((p) => p.id === id) || null;
  }

  // What the UI needs in one call.
  snapshot(catalogue) {
    const project = this.activeProject();
    return {
      folders: this.state.folders,
      projects: this.state.projects.map(({ id, name, folderId, videos }) => ({
        id, name, folderId, videoCount: videos.length,
      })),
      presets: this.state.presets,
      collections: this.state.collections,
      activeProject: project ? project.id : null,
      activeProjectName: project ? project.name : null,
      videos: project ? project.videos : [],
      sequence: project ? project.sequence : null,
      activeVideo: this.state.activeVideo,
      effects: catalogue,
    };
  }
}
