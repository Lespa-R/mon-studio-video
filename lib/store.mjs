// The studio's persistent state: folders → projects → videos → effects,
// plus a library of user-made effect presets.
//
// One JSON file, loaded once and written back on every mutation. Small enough
// that anything cleverer would be premature.

import fsp from "node:fs/promises";
import crypto from "node:crypto";

export const newId = (prefix) => `${prefix}${crypto.randomBytes(4).toString("hex")}`;

const EMPTY = () => ({
  version: 2,
  folders: [],
  projects: [],
  presets: [],
  activeProject: null,
  activeVideo: null,
});

// v1 kept a flat `videos` array at the root. Wrap it in a project so nothing
// the user already set up is lost.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return EMPTY();
  if (raw.version >= 2) {
    return { ...EMPTY(), ...raw, version: 2 };
  }
  const state = EMPTY();
  if (Array.isArray(raw.videos) && raw.videos.length) {
    const project = { id: newId("prj_"), name: "Projet 1", folderId: null, videos: raw.videos };
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

  async load() {
    try {
      this.state = migrate(JSON.parse(await fsp.readFile(this.file, "utf8")));
    } catch {
      this.state = EMPTY();
    }
    if (!this.state.projects.length) {
      const project = { id: newId("prj_"), name: "Projet 1", folderId: null, videos: [] };
      this.state.projects.push(project);
      this.state.activeProject = project.id;
    }
    if (!this.project(this.state.activeProject)) {
      this.state.activeProject = this.state.projects[0].id;
    }
    await this.save();
    return this.state;
  }

  save() {
    this.queue = this.queue.then(() =>
      fsp.writeFile(this.file, JSON.stringify(this.state, null, 2)));
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
    const project = {
      id: newId("prj_"),
      name: name || "Nouveau projet",
      folderId: this.folder(folderId) ? folderId : null,
      videos: [],
    };
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

  addPreset({ name, type, params }) {
    const preset = { id: newId("pre_"), name: name || "Sans nom", type, params };
    this.state.presets.push(preset);
    return preset;
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
      activeProject: project ? project.id : null,
      activeProjectName: project ? project.name : null,
      videos: project ? project.videos : [],
      activeVideo: this.state.activeVideo,
      effects: catalogue,
    };
  }
}
