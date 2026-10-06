// Where the studio's disk space goes, and what can safely be freed.
//
// classify() is pure: it takes file listings (name + size + mtime) and the
// studio state, and sorts every file into one of these kinds:
//
//   source    a clip's working video                    kept — delete the clip instead
//   original  the untouched original kept by a trim     freeing it makes the trim final
//   matte     a clip's cut-out (VP9 WebM)               cache: rebuilt at the next preview
//   people    a clip's people tracking                  cache: rebuilt at the next preview
//   transcript a clip's Whisper transcript               cache: rebuilt when the text editor needs it
//   pin       a pinned text's scenery tracking           cache: rebuilt at the next preview
//   render    an exported MP4                           yours: keep, move or delete
//   asset     an image or font, used or not             unused ones can go
//   orphan    a media file no clip or effect refers to  leftovers of deleted clips
//   temp      interrupted work, caches, old snapshots   safe to delete
//
// The server lists the files, calls this, and only ever deletes a file that
// this function put in a deletable category — never on the UI's word alone.

const ASSET = /^(asset_[a-f0-9]{8,32}\.(png|jpe?g|webp)|font_[a-f0-9]{8,32}\.(woff2|woff|ttf|otf))$/;

export const KINDS = {
  source: { label: "Vidéos des clips", hint: "Les vidéos de tes clips. Pour les supprimer, supprime le clip dans Montage." },
  original: { label: "Originaux gardés après rognage", hint: "Permettent de rallonger ou d'annuler un rognage. Les supprimer rend le rognage définitif." },
  matte: { label: "Découpes (cache)", hint: "Les silhouettes détourées. Recalculées automatiquement au prochain aperçu." },
  people: { label: "Suivi des personnes (cache)", hint: "Recalculé automatiquement au prochain aperçu qui en a besoin." },
  transcript: { label: "Transcriptions (cache)", hint: "Les mots de Whisper pour le montage par le texte. Refaites à la demande ; les coupes déjà appliquées restent." },
  pin: { label: "Suivi du décor, des objets et flous (cache)", hint: "Où se trouvent les endroits du décor et les objets que suivent tes effets, et les calques de flou. Recalculés au prochain aperçu." },
  render: { label: "Rendus MP4", hint: "Tes vidéos exportées. Déplace celles à garder, supprime les autres." },
  asset: { label: "Images et polices", hint: "Importées pour tes effets et chartes. Celles qui ne servent plus peuvent partir." },
  orphan: { label: "Fichiers orphelins", hint: "Restes de clips supprimés : plus rien ne s'en sert." },
  temp: { label: "Fichiers temporaires", hint: "Travaux interrompus, caches de travail, anciennes sauvegardes corrompues." },
  state: { label: "Bibliothèque (studio.json)", hint: "Tes projets, effets et réglages. Indispensable." },
};

// Which kinds the studio lets you delete, and how.
export const DELETABLE = new Set(["original", "matte", "people", "transcript", "pin", "render", "asset", "orphan", "temp"]);

export function classify({ media = [], renders = [], root = [], cache = [] }, state) {
  const items = [];
  const clipOf = new Map();
  for (const project of state.projects || []) {
    for (const v of project.videos || []) {
      const ids = {
        [`${v.id}-bg${v.ext}`]: "source",
        [`${v.id}-fg.webm`]: "matte",
        [`${v.id}-people.json`]: "people",
        [`${v.id}-transcript.json`]: "transcript",
        [`${v.id}-object.mp4`]: "matte",
      };
      if (v.trim) ids[`${v.id}-orig${v.trim.ext}`] = "original";
      for (const [file, kind] of Object.entries(ids)) {
        clipOf.set(file, { kind, videoId: v.id, clip: v.name, projectId: project.id, project: project.name });
      }
    }
  }

  // An asset is in use if a clip's effects, a preset or a brand kit names it.
  // (The list of imported fonts itself does not count as a use.)
  const uses = JSON.stringify([state.projects || [], state.presets || [], state.brands || []]);

  for (const f of media) {
    const clip = clipOf.get(f.name);
    if (clip) { items.push({ ...f, area: "media", ...clip }); continue; }
    // A pinned text's track: one per spot, so not in the name map.
    const pin = /^(vid_[A-Za-z0-9]+)-(?:pin-[a-f0-9]+\.json|obj-[a-f0-9]+\.(?:json|mp4)|blur-[a-f0-9]+\.webm)$/.exec(f.name);
    const owner = pin && clipOf.get([...clipOf.keys()].find((n) => n.startsWith(`${pin[1]}-bg`)));
    if (owner) { items.push({ ...f, area: "media", ...owner, kind: "pin" }); continue; }
    if (/\.partial\.|\.tmp$|\.upright\.mp4$/.test(f.name)) { items.push({ ...f, area: "media", kind: "temp" }); continue; }
    if (ASSET.test(f.name)) {
      items.push({ ...f, area: "media", kind: "asset", used: uses.includes(f.name), font: f.name.startsWith("font_") });
      continue;
    }
    items.push({ ...f, area: "media", kind: "orphan" });
  }
  for (const f of renders) {
    if (/\.mp4$/i.test(f.name)) items.push({ ...f, area: "renders", kind: "render" });
    else items.push({ ...f, area: "renders", kind: "temp" });
  }
  for (const f of root) {
    if (/^studio(\.backup)?\.json$/.test(f.name)) items.push({ ...f, area: "root", kind: "state" });
    else if (/^render-.*\.html$|^studio\.corrupt-.*\.json$|^studio\.json\.tmp$/.test(f.name)) items.push({ ...f, area: "root", kind: "temp" });
  }
  for (const f of cache) items.push({ ...f, area: "cache", kind: "temp" });

  // A file being written right now (a render in progress, a cut-out being
  // encoded) is never offered for deletion.
  const now = Date.now();
  for (const it of items) {
    it.deletable = DELETABLE.has(it.kind)
      && !(it.kind === "asset" && it.used)
      && !(it.mtime && now - it.mtime < 30_000);
  }

  const totals = {};
  for (const it of items) totals[it.kind] = (totals[it.kind] || 0) + it.size;
  const total = items.reduce((s, it) => s + it.size, 0);
  return { items, totals, total };
}
