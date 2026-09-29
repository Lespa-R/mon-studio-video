// Mon Studio HyperFrame — interface (app-editor.js).
// Subtitles, dragging on the preview, projects & folders, presets.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ================================================== subtitles

// Lines are edited here as a local copy and saved (debounced) as a whole:
// the server keeps the timed words wherever a line's text is unchanged.
let ccCues = [];        // the selected clip's lines, being edited
let ccFor = null;       // the clip they belong to
let ccTimer = null;

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
};

function showRightPanel(which) {
  $("#panel-fx").hidden = which !== "fx";
  $("#panel-cc").hidden = which !== "cc";
  $("#panel-prj").hidden = which !== "prj";
  $("#rt-fx").classList.toggle("on", which === "fx");
  $("#rt-cc").classList.toggle("on", which === "cc");
  $("#rt-prj").classList.toggle("on", which === "prj");
  if (which === "cc") drawCaptions(true);
}
$("#rt-fx").onclick = () => showRightPanel("fx");
$("#rt-cc").onclick = () => showRightPanel("cc");
$("#rt-prj").onclick = () => showRightPanel("prj");

function ccNote(text, warn = false) {
  const el = $("#cc-note");
  el.textContent = text;
  el.classList.toggle("warn", warn);
}
const CC_INFO = "La transcription se fait sur ce Mac avec la reconnaissance vocale d'Apple : rien ne part sur Internet. " +
  "La première fois, macOS demande l'autorisation pour « Mon Studio – Transcription ».";

// `force` reloads the lines from the clip; otherwise a redraw while the
// user is typing would throw away what they typed.
function drawCaptions(force = false) {
  if ($("#panel-cc").hidden) return;
  const v = videoById(selected);
  const langSel = $("#cc-lang");
  if (!langSel.options.length && state.options) {
    for (const l of state.options.languages) {
      const opt = document.createElement("option");
      opt.value = l.value; opt.textContent = l.label;
      langSel.appendChild(opt);
    }
  }
  for (const id of ["cc-gen", "cc-import", "cc-export", "cc-clear"]) $("#" + id).disabled = !v;
  const list = $("#cc-list");
  if (!v) { list.innerHTML = '<div class="none">Sélectionne une vidéo.</div>'; ccFor = null; return; }
  if (!force && ccFor === v.id && list.contains(document.activeElement)) return;

  ccFor = v.id;
  ccCues = JSON.parse(JSON.stringify(v.captions?.cues || []));
  if (v.captions?.lang) langSel.value = v.captions.lang;
  $("#cc-export").disabled = !ccCues.length;
  $("#cc-clear").disabled = !ccCues.length;
  $("#cc-gen").textContent = ccCues.length ? "Régénérer" : "Générer";

  const hasEffect = v.effects.some((e) => e.type === "captions" && e.enabled !== false);
  if (!v.hasAudio) ccNote("Ce clip n'a pas de son : importe un fichier SRT ou ajoute les lignes à la main.");
  else if (ccCues.length && !hasEffect) ccNote("Ces sous-titres ne s'affichent pas : ajoute ou active l'effet « Sous-titres » dans l'onglet Effets.", true);
  else ccNote(ccCues.length ? `${ccCues.length} lignes. Modifie le texte ou les temps ; le style se règle dans l'effet « Sous-titres ».` : CC_INFO);

  list.innerHTML = "";
  if (!ccCues.length) {
    const add = document.createElement("button");
    add.textContent = "+ Écrire les sous-titres à la main";
    add.style.width = "100%";
    add.onclick = () => { insertCue(-1); };
    list.appendChild(add);
    return;
  }
  ccCues.forEach((cue, i) => list.appendChild(cueRow(cue, i)));
}

function cueRow(cue, i) {
  const row = document.createElement("div");
  row.className = "cue";
  row.dataset.cue = cue.id;
  row.innerHTML = `
    <div class="cue-top">
      <button class="go" title="Aller à ce moment">▶ ${fmtTime(cue.start)}</button>
      <input type="number" class="cs" step="0.1" min="0" value="${cue.start}" title="Début (s)" />
      →
      <input type="number" class="ce" step="0.1" min="0" value="${cue.end}" title="Fin (s)" />
      <span class="grow"></span>
      <button class="add" title="Ajouter une ligne après">+</button>
      <button class="x" title="Supprimer la ligne">×</button>
    </div>
    <textarea rows="2"></textarea>`;
  const text = row.querySelector("textarea");
  text.value = cue.text;
  text.oninput = () => { cue.text = text.value; saveCaptionsSoon(); };
  const num = (sel, key) => {
    const el = row.querySelector(sel);
    el.onchange = () => {
      const v = el.valueAsNumber;
      if (!Number.isFinite(v)) return;
      cue[key] = Math.max(0, v);
      saveCaptionsSoon(true);
    };
  };
  num(".cs", "start");
  num(".ce", "end");
  row.querySelector(".go").onclick = () => post({ type: "seek", t: cue.start + 0.05 });
  text.onfocus = () => post({ type: "seek", t: cue.start + 0.05 });
  row.querySelector(".add").onclick = () => insertCue(i);
  row.querySelector(".x").onclick = () => {
    ccCues.splice(i, 1);
    saveCaptionsSoon(true);
  };
  return row;
}

function insertCue(after) {
  const v = videoById(selected);
  if (!v) return;
  const prev = ccCues[after];
  const next = ccCues[after + 1];
  const start = prev ? prev.end : 0;
  const end = Math.min(next ? next.start : v.duration, start + 2);
  if (end - start < 0.2) return toast("Pas de place ici : raccourcis la ligne suivante d'abord.");
  ccCues.splice(after + 1, 0, { start, end, text: "Nouvelle ligne" });
  saveCaptionsSoon(true, after + 1);
}

// Text edits wait for a pause in typing; structural edits (times, add,
// delete) are saved at once and redraw the list.
function saveCaptionsSoon(structural = false, focusAt = null) {
  const videoId = ccFor;
  clearTimeout(ccTimer);
  ccTimer = setTimeout(async () => {
    const { captions, added } = await api(`/api/videos/${videoId}/captions`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cues: ccCues, lang: $("#cc-lang").value, ensureEffect: true }),
    });
    const v = videoById(videoId);
    if (v) v.captions = captions;
    if (added) await refresh();
    if (structural) {
      drawCaptions(true);
      if (focusAt !== null) {
        const ta = document.querySelectorAll("#cc-list textarea")[focusAt];
        if (ta) { ta.focus(); ta.select(); }
      }
    } else {
      // Keep the typed text, take the server's ids for new lines.
      captions.cues.forEach((c, i) => { if (ccCues[i]) ccCues[i].id = c.id; });
    }
    if (selected === videoId) preview();
  }, structural ? 0 : 700);
}

// Highlight the line being said, during playback or after a seek.
function markCue(t) {
  if ($("#panel-cc").hidden || t === null || t === undefined) return;
  for (const row of document.querySelectorAll("#cc-list .cue")) {
    const cue = ccCues.find((c) => c.id === row.dataset.cue);
    row.classList.toggle("now", Boolean(cue && t >= cue.start && t < cue.end));
  }
}

$("#cc-gen").onclick = async () => {
  const v = videoById(selected);
  if (!v) return;
  if (v.captions?.cues?.length && !(await dialog({
    title: "Régénérer les sous-titres ?",
    message: "Les lignes actuelles, et tes corrections, seront remplacées par une nouvelle transcription.",
    okLabel: "Régénérer", danger: true,
  }))) return;
  const button = $("#cc-gen");
  button.disabled = true;
  ccNote("Transcription en cours sur ce Mac… Si macOS demande l'autorisation pour « Mon Studio – Transcription », accepte-la.");
  $("#prog").hidden = false;
  try {
    const { job } = await api(`/api/videos/${v.id}/captions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: $("#cc-lang").value }),
    });
    const done = await waitJob(job.id);
    await refresh();
    drawCaptions(true);
    setStatus(done.result.cues
      ? `${done.result.cues} lignes de sous-titres créées.`
      : "Aucune parole reconnue dans ce clip.");
    preview();
  } catch (error) {
    ccNote(error.message, true);
    setStatus("");
  } finally {
    button.disabled = false;
    $("#prog").hidden = true;
  }
};

$("#cc-import").onclick = () => $("#cc-file").click();
$("#cc-file").onchange = async () => {
  const file = $("#cc-file").files && $("#cc-file").files[0];
  $("#cc-file").value = "";
  const v = videoById(selected);
  if (!file || !v) return;
  try {
    await api(`/api/videos/${v.id}/captions/import`, { method: "POST", body: await file.text() });
    await refresh();
    drawCaptions(true);
    preview();
  } catch (error) {
    ccNote(error.message, true);
  }
};
$("#cc-export").onclick = () => {
  const v = videoById(selected);
  if (v) location.href = `/api/videos/${v.id}/captions.srt`;
};
$("#cc-clear").onclick = async () => {
  const v = videoById(selected);
  if (!v || !(await askConfirm("Effacer les sous-titres ?", "Toutes les lignes de ce clip seront supprimées."))) return;
  await api(`/api/videos/${v.id}/captions`, { method: "DELETE" });
  await refresh();
  drawCaptions(true);
  preview();
};

// ------------------------------------------- drag on the preview

// Every animation that can move (its catalogue entry has `drag`) gets
// a handle over the preview while it is on screen and the preview is
// paused. The handle is sized on the element's own box, read straight
// from the preview's document (same origin) and mapped through the
// scale the frame applies. Dropping it writes the new position:
//   drag.key   → params[key] = "free", x / y = the box's new centre (%)
//   drag.delta → x / y shifted by the move (the arrow's target)
let handlesAt = 0;
let dragging = null;

function previewDoc() {
  try {
    const iframe = $("#frame iframe");
    const w = iframe && iframe.contentWindow;
    if (!w || !w.__studioTime) return null;
    return { iframe, doc: iframe.contentDocument, t: w.__studioTime() };
  } catch { return null; }
}

// The union of the element's marked parts, in canvas pixels.
function dragBox(doc, fxId) {
  let box = null;
  for (const el of doc.querySelectorAll(`[data-drag="${fxId}"]`)) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    box = box
      ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top),
          right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return box;
}

function drawHandles() {
  const frame = $("#frame");
  let layer = frame.querySelector(".handles");
  const v = videoById(selected);
  const p = !playing && !$("#view-edit").hidden && v ? previewDoc() : null;
  if (!p) { if (layer && !dragging) layer.hidden = true; return; }
  if (dragging) return;
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "handles";
    frame.appendChild(layer);
  }
  layer.hidden = false;

  const fr = frame.getBoundingClientRect();
  const ir = p.iframe.getBoundingClientRect();
  const k = ir.width / (p.iframe.offsetWidth || ir.width);
  const ox = ir.left - fr.left - frame.clientLeft;
  const oy = ir.top - fr.top - frame.clientTop;
  const seen = new Set();

  for (const fx of v.effects) {
    const def = state.effects.find((e) => e.type === fx.type);
    if (!def || !def.drag || fx.enabled === false) continue;
    // Only while it is on screen.
    const start = Number(fx.start) || 0;
    const end = fx.duration == null ? v.duration : start + Number(fx.duration);
    if (p.t < start || p.t > end) continue;
    const box = dragBox(p.doc, fx.id);
    if (!box) continue;
    seen.add(fx.id);

    let h = layer.querySelector(`[data-h="${fx.id}"]`);
    if (!h) {
      h = document.createElement("div");
      h.className = "handle";
      h.dataset.h = fx.id;
      h.title = "Glisse pour déplacer · clique pour régler";
      h.appendChild(document.createElement("span"));
      h.addEventListener("pointerdown", (e) => startDrag(e, h, fx.id));
      layer.appendChild(h);
    }
    h.querySelector("span").textContent = fx.name || def.label;
    const pad = 4;
    h.style.left = ox + box.left * k - pad + "px";
    h.style.top = oy + box.top * k - pad + "px";
    h.style.width = (box.right - box.left) * k + pad * 2 + "px";
    h.style.height = (box.bottom - box.top) * k + pad * 2 + "px";
  }
  for (const h of [...layer.children]) if (!seen.has(h.dataset.h)) h.remove();
}

function focusCard(fxId) {
  const card = document.querySelector(`#stack .fx[data-fx="${fxId}"]`);
  if (!card) return;
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

function startDrag(e, handle, fxId) {
  if (e.button !== 0) return;
  const v = videoById(selected);
  const p = previewDoc();
  const fx = v && v.effects.find((x) => x.id === fxId);
  const def = fx && state.effects.find((x) => x.type === fx.type);
  if (!p || !def) return;
  e.preventDefault();
  // Followed on the window, so a fast move that leaves the handle (or
  // lands over the iframe) is not lost.
  try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }

  const ir = p.iframe.getBoundingClientRect();
  const W = p.iframe.offsetWidth;
  const H = p.iframe.offsetHeight;
  const k = ir.width / W;
  const box = dragBox(p.doc, fxId);
  const root = p.doc.getElementById(fxId);
  // Stage effects (text behind the person, titles) live in source
  // pixels on a stage that is itself scaled onto the canvas.
  const stage = p.doc.getElementById("stage");
  const sk = def.drag.stage && stage ? stage.getBoundingClientRect().width / stage.offsetWidth : 1;
  // Its scrim, if any, travels with it.
  const movers = [root, p.doc.getElementById(fxId + "-scrim")].filter(Boolean);
  const x0 = e.clientX;
  const y0 = e.clientY;
  const left = parseFloat(handle.style.left);
  const top = parseFloat(handle.style.top);
  let dx = 0;
  let dy = 0;
  dragging = { fxId };
  handle.classList.add("dragging");

  const move = (ev) => {
    dx = ev.clientX - x0;
    dy = ev.clientY - y0;
    handle.style.left = left + dx + "px";
    handle.style.top = top + dy + "px";
    // Live feedback: the CSS `translate` property composes with the
    // transforms GSAP writes, so nothing else in the element moves.
    for (const el of movers) el.style.translate = `${dx / k / sk}px ${dy / k / sk}px`;
  };
  const end = (ev, cancelled) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape, true);
    handle.classList.remove("dragging");
    dragging = null;
    const moved = Math.hypot(dx, dy) > 3;
    if (cancelled || !moved) {
      for (const el of movers) el.style.translate = "";
      if (!cancelled) focusCard(fxId);
      return;
    }
    const clamp = (n) => Math.round(Math.min(100, Math.max(0, n)) * 2) / 2;
    const cdx = dx / k;
    const cdy = dy / k;
    let params;
    const following = def.drag.offset || (def.drag.follow && fx.params[def.drag.key] === def.drag.follow);
    if (def.drag.stage && following) {
      // It follows someone: the move becomes an offset from that
      // person (% of the source frame), so it keeps following.
      const nudge = (key, d, size) => {
        const v = Number(fx.params[key]) || 0;
        return Math.round(Math.min(50, Math.max(-50, v + (d / sk / size) * 100)) * 2) / 2;
      };
      params = { ox: nudge("ox", cdx, stage.offsetWidth), oy: nudge("oy", cdy, stage.offsetHeight) };
    } else if (def.drag.stage) {
      // Added to where the line is anchored, in source pixels.
      const ax = Number(root.dataset.anchorX);
      const ay = Number(root.dataset.anchorY);
      params = {
        [def.drag.key]: "free",
        x: clamp(((ax + cdx / sk) / stage.offsetWidth) * 100),
        y: clamp(((ay + cdy / sk) / stage.offsetHeight) * 100),
      };
    } else if (def.drag.delta) {
      const at = (key) => {
        const f = def.schema.find((x) => x.key === key);
        return Number(fx.params[key] ?? (f ? f.default : 50));
      };
      params = { x: clamp(at("x") + (cdx / W) * 100), y: clamp(at("y") + (cdy / H) * 100) };
    } else {
      const cx = (box.left + box.right) / 2 + cdx;
      const cy = (box.top + box.bottom) / 2 + cdy;
      params = { [def.drag.key]: "free", x: clamp((cx / W) * 100), y: clamp((cy / H) * 100) };
    }
    focusCard(fxId);
    setStatus(`« ${fx.name || def.label} » déplacé.`);
    patch(v.id, fxId, { params });
  };
  const up = (ev) => end(ev, false);
  const cancel = (ev) => end(ev, true);
  // Escape puts it back where it was.
  const escape = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); end(ev, true); } };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape, true);
}

(function trackPlayhead() {
  function frame() {
    let t = null;
    let duration = 0;
    try {
      const w = $("#frame iframe").contentWindow;
      if (w.__studioTime) { t = w.__studioTime(); duration = w.__studioDuration; }
    } catch { /* iframe mid-reload */ }
    // The timeline is laid out in % of the clip (its width is the zoom).
    const head = $("#tl-head");
    if (t === null || !duration || $("#tl").hidden) head.style.display = "none";
    else { head.style.display = "block"; head.style.left = (t / duration) * 100 + "%"; }
    if (typeof onPlayhead === "function") onPlayhead(t, duration);
    const now = performance.now();
    if (now - handlesAt > 120) { handlesAt = now; drawHandles(); markCue(t); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();


// ------------------------------------------------- projects & folders

function drawTree() {
  const el = $("#tree");
  el.innerHTML = "";

  const render = (project) => {
    const row = document.createElement("div");
    row.className = "tree-row project" + (project.id === state.activeProject ? " on" : "");
    row.innerHTML = `
      <span class="grow">${escapeHtml(project.name)}</span>
      <span class="count">${project.videoCount}</span>
      <button class="ren" title="Renommer">✎</button>
      <button class="x" title="Supprimer">×</button>`;
    row.onclick = async (e) => {
      if (e.target.closest("button")) return;
      openProject(project.id);
      // Also remembered as the default for the next tab that opens.
      await api(`/api/projects/${project.id}/activate`, { method: "POST" });
      selected = null;
      await refresh();
      const v = state.videos[0];
      if (v) await select(v.id); else clearFrame();
    };
    row.querySelector(".ren").onclick = async () => {
      const name = await askText("Renommer le projet", project.name);
      if (!name) return;
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refresh();
    };
    row.querySelector(".x").onclick = async () => {
      if (!(await askConfirm("Supprimer ce projet ?",
        `« ${project.name} » et ses ${project.videoCount} vidéo(s) seront supprimés.`))) return;
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      selected = null;
      await refresh();
      const v = state.videos[0];
      if (v) await select(v.id); else clearFrame();
    };
    return row;
  };

  // root-level projects first, then one block per folder
  for (const p of state.projects.filter((p) => !p.folderId)) el.appendChild(render(p));

  for (const folder of state.folders) {
    const head = document.createElement("div");
    head.className = "tree-row folder";
    head.innerHTML = `
      <span class="grow">${escapeHtml(folder.name)}</span>
      <button class="ren" title="Renommer">✎</button>
      <button class="x" title="Supprimer le dossier">×</button>`;
    head.querySelector(".ren").onclick = async () => {
      const name = await askText("Renommer le dossier", folder.name);
      if (!name) return;
      await api(`/api/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refresh();
    };
    head.querySelector(".x").onclick = async () => {
      if (!(await askConfirm(`Supprimer le dossier « ${folder.name} » ?`,
        "Les projets qu'il contient sont conservés et remontent à la racine."))) return;
      await api(`/api/folders/${folder.id}`, { method: "DELETE" });
      await refresh();
    };
    el.appendChild(head);
    for (const p of state.projects.filter((p) => p.folderId === folder.id)) {
      el.appendChild(render(p));
    }
  }
}

$("#new-project").onclick = async () => {
  const folders = state.folders;
  const answer = await dialog({
    title: "Nouveau projet",
    value: "Nouveau projet",
    okLabel: "Créer",
    choices: folders.length
      ? [{ value: "", label: "À la racine" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]
      : null,
    choiceLabel: "Dossier",
  });
  if (!answer || !answer.text) return;
  const name = answer.text;
  const folderId = answer.choice || null;
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, folderId }),
  });
  openProject(created.project.id);
  selected = null;
  await refresh();
  clearFrame();
};

$("#new-folder").onclick = async () => {
  const name = await askText("Nouveau dossier", "Nouveau dossier", "Créer");
  if (!name) return;
  await api("/api/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await refresh();
};

// -------------------------------------------------------- my presets

function drawPresets() {
  const el = $("#presets");
  el.innerHTML = "";
  if (!state.presets.length) return;
  for (const preset of state.presets) {
    const def = state.effects.find((e) => e.type === preset.type);
    const row = document.createElement("div");
    row.className = "preset";
    row.innerHTML = `
      <span class="grow">★ ${escapeHtml(preset.name)}</span>
      <span style="font-size:10.5px;opacity:.7">${escapeHtml(def ? def.label : preset.type)}</span>
      <button class="x" title="Supprimer le préréglage">×</button>`;
    row.querySelector(".x").onclick = async () => {
      await api(`/api/presets/${preset.id}`, { method: "DELETE" });
      await refresh();
      fillEffectPicker();
    };
    el.appendChild(row);
  }
}

// The catalogue in its categories, in the order the server gives them.
function effectsByCategory() {
  const groups = new Map();
  for (const e of state.effects) {
    const key = e.category || "Effets";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups];
}

function fillEffectPicker() {
  const sel = $("#fx-type");
  const keep = sel.value;
  sel.innerHTML = "";

  for (const [category, list] of effectsByCategory()) {
    const group = document.createElement("optgroup");
    group.label = category;
    for (const e of list) {
      const opt = document.createElement("option");
      opt.value = "type:" + e.type;
      opt.textContent = e.label;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }

  if (state.presets.length) {
    const mine = document.createElement("optgroup");
    mine.label = "Mes préréglages";
    for (const preset of state.presets) {
      const opt = document.createElement("option");
      opt.value = "preset:" + preset.id;
      opt.textContent = "★ " + preset.name;
      mine.appendChild(opt);
    }
    sel.appendChild(mine);
  }
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  showEffectHint();
}

function showEffectHint() {
  const value = $("#fx-type").value || "";
  if (value.startsWith("preset:")) {
    const preset = state.presets.find((p) => "preset:" + p.id === value);
    const def = preset && state.effects.find((e) => e.type === preset.type);
    $("#fx-hint").textContent = def
      ? `Ton préréglage, basé sur « ${def.label} ».`
      : "";
    return;
  }
  const e = state.effects.find((x) => "type:" + x.type === value);
  $("#fx-hint").textContent = e ? e.hint : "";
}
