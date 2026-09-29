// Mon Studio Vidéo — interface (app-library.js).
// Effect library page.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ================================================= library page

let libCollection = "all";   // "all" | "none" | <collectionId>
let libPreset = null;        // selected preset id
let libPlaying = false;

function visiblePresets() {
  if (libCollection === "all") return state.presets;
  if (libCollection === "none") return state.presets.filter((p) => !p.collectionId);
  return state.presets.filter((p) => p.collectionId === libCollection);
}

function drawCollections() {
  const el = $("#collections");
  el.innerHTML = "";
  const row = (id, label, count, removable) => {
    const div = document.createElement("div");
    div.className = "tree-row" + (libCollection === id ? " on" : "");
    div.innerHTML = `<span class="grow">${escapeHtml(label)}</span>
      <span class="count">${count}</span>` +
      (removable ? `<button class="ren" title="Renommer">✎</button>
                    <button class="x" title="Supprimer">×</button>` : "");
    div.onclick = (e) => {
      if (e.target.closest("button")) return;
      libCollection = id;
      const first = visiblePresets()[0];
      libPreset = first ? first.id : null;
      drawEffectLibrary();
    };
    if (removable) {
      div.querySelector(".ren").onclick = async () => {
        const name = await askText("Renommer la collection", label);
        if (!name) return;
        await api(`/api/collections/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await refresh();
      };
      div.querySelector(".x").onclick = async () => {
        if (!(await askConfirm(`Supprimer la collection « ${label} » ?`,
          "Les préréglages qu'elle contient sont conservés."))) return;
        await api(`/api/collections/${id}`, { method: "DELETE" });
        if (libCollection === id) libCollection = "all";
        await refresh();
      };
    }
    el.appendChild(div);
  };

  row("all", "Tous", state.presets.length, false);
  row("none", "Sans collection", state.presets.filter((p) => !p.collectionId).length, false);
  for (const c of state.collections) {
    row(c.id, c.name, state.presets.filter((p) => p.collectionId === c.id).length, true);
  }
}

function drawLibraryList() {
  const el = $("#lib-list");
  el.innerHTML = "";
  const list = visiblePresets();
  if (!list.length) {
    el.innerHTML = '<div class="lib-empty">Aucun préréglage ici.</div>';
    return;
  }
  for (const preset of list) {
    const def = state.effects.find((e) => e.type === preset.type);
    const item = document.createElement("div");
    item.className = "lib-item" + (preset.id === libPreset ? " on" : "");
    item.innerHTML = `
      <div class="meta">
        <div class="nm">★ ${escapeHtml(preset.name)}</div>
        <div class="base">${escapeHtml(def ? def.label : preset.type)}</div>
      </div>
      <button class="x" title="Supprimer">×</button>`;
    item.onclick = (e) => {
      if (e.target.closest("button")) return;
      libPreset = preset.id;
      drawEffectLibrary();
      previewPreset();
    };
    item.querySelector(".x").onclick = async () => {
      if (!(await askConfirm("Supprimer ce préréglage ?", `« ${preset.name} »`))) return;
      await api(`/api/presets/${preset.id}`, { method: "DELETE" });
      if (libPreset === preset.id) libPreset = null;
      await refresh();
      fillEffectPicker();
    };
    el.appendChild(item);
  }
}

function drawLibraryEditor() {
  const editor = $("#lib-editor");
  const preset = state.presets.find((p) => p.id === libPreset);
  editor.innerHTML = "";

  const disabled = !preset;
  for (const id of ["lib-dup", "lib-del", "lib-name", "lib-collection", "lib-play"]) {
    $("#" + id).disabled = disabled;
  }
  if (!preset) {
    $("#lib-name").value = "";
    return;
  }

  $("#lib-name").value = preset.name;

  const coll = $("#lib-collection");
  coll.innerHTML = '<option value="">Sans collection</option>';
  for (const c of state.collections) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    if (preset.collectionId === c.id) opt.selected = true;
    coll.appendChild(opt);
  }

  const def = state.effects.find((e) => e.type === preset.type);
  if (!def) return;
  for (const f of def.schema) {
    if (!fieldApplies(def, f, preset.params)) continue;
    editor.appendChild(field(f, preset.params[f.key], async (value, extra = {}) => {
      await api(`/api/presets/${preset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: { ...extra, [f.key]: value } }),
      });
      await refresh();
      previewPreset();
    }, preset.id));
  }
}

function drawEffectLibrary() {
  drawCollections();
  drawLibraryList();
  drawLibraryEditor();

  const clip = $("#lib-clip");
  const keep = clip.value;
  clip.innerHTML = "";
  const all = state.projects.length ? state.videos : [];
  for (const v of all) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    clip.appendChild(opt);
  }
  if (!all.length) {
    clip.innerHTML = '<option value="">aucun clip</option>';
  } else if ([...clip.options].some((o) => o.value === keep)) {
    clip.value = keep;
  }
}

async function previewPreset() {
  const preset = state.presets.find((p) => p.id === libPreset);
  const frame = $("#lib-frame");
  if (!preset) {
    frame.innerHTML = '<div class="empty">Sélectionne un préréglage.</div>';
    return;
  }
  const videoId = $("#lib-clip").value;
  const v = state.videos.find((x) => x.id === videoId);
  if (!v) {
    frame.innerHTML = '<div class="empty">Ajoute un clip à un projet pour prévisualiser.</div>';
    return;
  }

  frame.classList.add("busy");
  try {
    const { job } = await api(
      `/api/presets/${preset.id}/prepare?video=${videoId}`, { method: "POST" });
    await waitJob(job.id);
  } catch (error) {
    frame.classList.remove("busy");
    return setStatus(error.message, true);
  }

  const at = showcaseTime(v, { start: 0, duration: null, params: preset.params });
  frame.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.src = `/preview-preset/${preset.id}?video=${videoId}&v=${Date.now()}#t=${at.toFixed(3)}`;
  iframe.onload = () => fitFrame(iframe, v, frame);
  frame.appendChild(iframe);
  fitFrame(iframe, v, frame);
  libPlaying = false;
  $("#lib-play").textContent = "Lecture";
  setTimeout(() => frame.classList.remove("busy"), 2500);
}

// ----------------------------------------------------- library wiring

function fillBasePicker() {
  const sel = $("#lib-base");
  const keep = sel.value;
  sel.innerHTML = "";
  for (const [category, list] of effectsByCategory()) {
    const group = document.createElement("optgroup");
    group.label = category;
    for (const e of list) {
      const opt = document.createElement("option");
      opt.value = e.type;
      opt.textContent = e.label;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
  if (keep) sel.value = keep;
}

$("#lib-create").onclick = async () => {
  const type = $("#lib-base").value;
  // Created at once under a free name; the name field takes focus so it
  // can be renamed in place — no question asked.
  const def = state.effects.find((e) => e.type === type);
  const base = def ? def.label : "Préréglage";
  const taken = new Set(state.presets.map((x) => x.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  const { preset } = await api("/api/presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type, name,
      collectionId: libCollection === "all" || libCollection === "none" ? null : libCollection,
    }),
  });
  libPreset = preset.id;
  await refresh();
  fillEffectPicker();
  previewPreset();
  const nameField = $("#lib-name");
  nameField.focus();
  nameField.select();
};

$("#lib-name").onchange = async () => {
  if (!libPreset) return;
  await api(`/api/presets/${libPreset}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: $("#lib-name").value }),
  });
  await refresh();
  fillEffectPicker();
};

$("#lib-collection").onchange = async () => {
  if (!libPreset) return;
  await api(`/api/presets/${libPreset}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ collectionId: $("#lib-collection").value || null }),
  });
  await refresh();
};

$("#lib-dup").onclick = async () => {
  if (!libPreset) return;
  const { preset } = await api(`/api/presets/${libPreset}/duplicate`, { method: "POST" });
  libPreset = preset.id;
  await refresh();
  fillEffectPicker();
};

$("#lib-del").onclick = async () => {
  const preset = state.presets.find((p) => p.id === libPreset);
  if (!preset || !(await askConfirm("Supprimer ce préréglage ?", `« ${preset.name} »`))) return;
  await api(`/api/presets/${preset.id}`, { method: "DELETE" });
  libPreset = null;
  await refresh();
  fillEffectPicker();
  previewPreset();
};

$("#lib-clip").onchange = () => previewPreset();

$("#lib-play").onclick = () => {
  libPlaying = !libPlaying;
  const iframe = $("#lib-frame iframe");
  if (iframe) iframe.contentWindow.postMessage(libPlaying ? "play" : "pause", "*");
  $("#lib-play").textContent = libPlaying ? "Pause" : "Lecture";
};

$("#new-collection").onclick = async () => {
  const name = await askText("Nouvelle collection", "Nouvelle collection", "Créer");
  if (!name) return;
  const { collection } = await api("/api/collections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  libCollection = collection.id;
  await refresh();
};
