// Mon Studio Vidéo — interface (app-core.js).
// Dialogs, render controls, preview player, jobs, timeline.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

const $ = (s) => document.querySelector(s);

// Every question the studio asks goes through this in-page dialog.
// Browsers embedded in apps often refuse the native ones — the Claude
// desktop pane throws on prompt() and answers every confirm() with false,
// which silently cancelled every deletion.
function dialog({ title, message = "", value, textLabel = "Nom", choices = null,
                  choiceLabel = "", choiceValue = "", okLabel = "OK", danger = false }) {
  return new Promise((resolve) => {
    const back = $("#dlg");
    const input = $("#dlg-input");
    const select = $("#dlg-select");
    const ok = $("#dlg-ok");

    $("#dlg-title").textContent = title;
    $("#dlg-msg").textContent = message;
    $("#dlg-msg").hidden = !message;
    $("#dlg-text-field").hidden = value === undefined;
    $("#dlg-text-label").textContent = textLabel;
    input.value = value ?? "";
    $("#dlg-choice-field").hidden = !choices;
    $("#dlg-choice-label").textContent = choiceLabel;
    select.innerHTML = "";
    for (const c of choices || []) {
      const opt = document.createElement("option");
      opt.value = c.value;
      opt.textContent = c.label;
      if (c.value === choiceValue) opt.selected = true;
      select.appendChild(opt);
    }
    ok.textContent = okLabel;
    ok.className = danger ? "danger" : "primary";
    back.hidden = false;
    setTimeout(() => {
      if (value !== undefined) { input.focus(); input.select(); } else ok.focus();
    });

    const finish = (result) => {
      back.hidden = true;
      document.removeEventListener("keydown", onKey, true);
      back.removeEventListener("mousedown", onBackdrop);
      ok.onclick = null;
      $("#dlg-cancel").onclick = null;
      resolve(result);
    };
    const accept = () => finish({ text: input.value.trim(), choice: select.value });
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
      if (e.key === "Enter" && e.target.tagName !== "SELECT" && e.target.tagName !== "BUTTON") {
        e.preventDefault(); e.stopPropagation(); accept();
      }
    };
    const onBackdrop = (e) => { if (e.target === back) finish(null); };
    ok.onclick = accept;
    $("#dlg-cancel").onclick = () => finish(null);
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", onBackdrop);
  });
}

// Any action that fails without its own handling ends up here, visibly —
// the library page has no status line, so failures there used to vanish.
let toastTimer = null;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}
window.addEventListener("unhandledrejection", (e) => {
  toast(e.reason && e.reason.message ? e.reason.message : String(e.reason));
});

// A name, or null if cancelled or left empty.
const askText = async (title, value, okLabel = "Enregistrer") => {
  const r = await dialog({ title, value, okLabel });
  return r && r.text ? r.text : null;
};
const askConfirm = async (title, message, okLabel = "Supprimer") =>
  Boolean(await dialog({ title, message, okLabel, danger: true }));

// This page only works when the studio serves it. Opened straight off
// disk (file://) every relative API path fails to resolve, with an error
// that says nothing useful — so say it here instead.
const SERVED = location.protocol === "http:" || location.protocol === "https:";

const api = async (url, options) => {
  let res;
  try {
    res = await fetch(url, options);
  } catch (error) {
    throw new Error(
      "Le serveur ne répond pas. Lance « npm start » puis ouvre http://localhost:3002",
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
};

let state = { videos: [], effects: [] };
let selected = null;
let playing = false;

// ---------------------------------------------------------- render UI

function videoById(id) { return state.videos.find((v) => v.id === id) || null; }

// Clips as thumbnails, like the Final Cut browser: a frame of the clip,
// its duration in the corner, name and effects underneath.
function drawLibrary() {
  const el = $("#library");
  el.innerHTML = "";
  const count = $("#clip-count");
  if (count) count.textContent = state.videos.length ? `${state.videos.length} clip${state.videos.length > 1 ? "s" : ""}` : "";
  if (!state.videos.length) {
    el.innerHTML = '<div class="none">Aucune vidéo.</div>';
    return;
  }
  const grid = document.createElement("div");
  grid.className = "clip-grid";
  for (const v of state.videos) {
    const row = document.createElement("div");
    row.className = "vid clip-tile" + (v.id === selected ? " on" : "");
    row.title = `${v.name}\n${v.width}×${v.height} · ${v.duration.toFixed(1)} s${v.trim ? " (rogné)" : ""}${v.face ? "" : " · sans visage"}`;
    row.innerHTML = `
      <div class="thumb" style="aspect-ratio:${v.width} / ${v.height}">
        <span class="tdur">${fmtTc(v.duration, v.fps, true)}</span>
        ${v.effects.length ? `<span class="tfx">✦ ${v.effects.length}</span>` : ""}
      </div>
      <div class="meta">
        <div class="name">${escapeHtml(v.name)}</div>
        <div class="dim">${v.width}×${v.height}${v.trim ? " · rogné" : ""}${v.face ? "" : " · sans visage"}</div>
      </div>
      <button class="x" title="Supprimer">×</button>`;
    clipThumb(v).then((url) => { if (url) row.querySelector(".thumb").style.backgroundImage = `url(${url})`; });
    row.onclick = (e) => {
      if (e.target.closest("button")) return;
      select(v.id);
    };
    row.querySelector(".x").onclick = async () => {
      if (!(await askConfirm("Supprimer ce clip ?",
        `« ${v.name} », ses effets et sa découpe seront supprimés.`))) return;
      await api(`/api/videos/${v.id}`, { method: "DELETE" });
      if (selected === v.id) { selected = null; clearFrame(); }
      await refresh();
    };
    grid.appendChild(row);
  }
  el.appendChild(grid);
}

// h:min:s:images, as in Final Cut. `short` drops the leading zero hours.
function fmtTc(t, fps = 30, short = false) {
  const f = Math.max(1, Math.round(fps || 30));
  const total = Math.max(0, Math.round((t || 0) * f));
  const ff = total % f;
  const s = Math.floor(total / f);
  const p = (n) => String(n).padStart(2, "0");
  const tc = `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
  // Short form, as on Final Cut's clip badges: 3:02 (s:images), 1:05:12 (min:s:images).
  if (!short) return tc;
  const parts = tc.split(":");
  while (parts.length > 2 && parts[0] === "00") parts.shift();
  parts[0] = String(Number(parts[0]));
  return parts.join(":");
}

// A frame of the clip, drawn once in the browser and kept for the session:
// the clip thumbnail and the timeline's filmstrip. Nothing is written on disk.
const thumbCache = new Map(); // `${id}@${at}` → Promise<dataURL|null>
function clipThumb(v, at) {
  const t = at ?? Math.min(1, v.duration / 3);
  const key = `${v.id}:${v.trim ? `${v.trim.start}-${v.trim.end}` : ""}@${t.toFixed(2)}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const p = new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = `/media/${encodeURIComponent(`${v.id}-bg${v.ext}`)}`;
    const done = (url) => { video.removeAttribute("src"); video.load(); resolve(url); };
    const timer = setTimeout(() => done(null), 8000);
    video.onloadeddata = () => { video.currentTime = Math.min(t, (video.duration || v.duration) - 0.05); };
    video.onseeked = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement("canvas");
        const h = 180;
        c.width = Math.round((h * video.videoWidth) / video.videoHeight) || 320;
        c.height = h;
        c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
        done(c.toDataURL("image/jpeg", 0.72));
      } catch { done(null); }
    };
    video.onerror = () => { clearTimeout(timer); done(null); };
  });
  thumbCache.set(key, p);
  return p;
}

function drawStack() {
  drawClipbar();
  const el = $("#stack");
  const v = videoById(selected);
  el.innerHTML = "";
  $("#fx-add").disabled = !v;
  drawInspectorHead(v);
  if (!v) { el.innerHTML = '<div class="none">Sélectionne une vidéo.</div>'; return; }
  if (!v.effects.length) { el.innerHTML = '<div class="none">Aucun effet. Ouvre le navigateur d\'effets (⌘5) et double-clique sur une vignette : l\'effet se pose à la tête de lecture.</div>'; return; }
  if (selectedFx && !v.effects.some((f) => f.id === selectedFx)) selectedFx = null;

  for (const fx of v.effects) {
    const def = state.effects.find((e) => e.type === fx.type);
    if (!def) continue;
    const card = document.createElement("div");
    // With an effect selected on the timeline, the others fold to their header.
    const folded = selectedFx && fx.id !== selectedFx;
    card.className = "fx" + (fx.id === selectedFx ? " sel" : "") + (folded ? " folded" : "");
    card.dataset.fx = fx.id;

    const head = document.createElement("div");
    head.className = "fx-head";
    head.innerHTML = `
      <input type="checkbox" class="on" ${fx.enabled !== false ? "checked" : ""} title="Activer" />
      <input type="text" class="t" value="${escapeHtml(fx.name || "")}"
             placeholder="${escapeHtml(def.label)}" title="Renommer cet effet" />
      <button class="copy" title="Copier cet effet">⧉</button>
      <button class="star" title="Enregistrer comme préréglage">★</button>
      <button class="x" title="Retirer">×</button>`;
    head.querySelector(".on").onchange = (e) =>
      patch(v.id, fx.id, { enabled: e.target.checked });

    const nameInput = head.querySelector(".t");
    nameInput.dataset.fx = fx.id;
    nameInput.dataset.key = "__name";
    nameInput.onchange = () => patch(v.id, fx.id, { name: nameInput.value });
    nameInput.onkeydown = (e) => { if (e.key === "Enter") nameInput.blur(); };

    head.querySelector(".copy").onclick = () => {
      setClipboard({ from: `${v.name} · ${fx.name || def.label}`, effects: [effectData(fx)] });
      setStatus(`« ${fx.name || def.label} » copié. Sélectionne un autre clip et colle-le.`);
    };

    head.querySelector(".star").onclick = async () => {
      const name = await askText("Enregistrer comme préréglage", fx.name || def.label);
      if (!name) return;
      await api("/api/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, fromVideo: v.id, fromEffect: fx.id }),
      });
      await refresh();
      fillEffectPicker();
      setStatus(`Préréglage « ${name} » enregistré.`);
    };

    head.querySelector(".x").onclick = async () => {
      await api(`/api/videos/${v.id}/effects/${fx.id}`, { method: "DELETE" });
      await refresh();
      preview();
    };
    card.appendChild(head);
    head.addEventListener("click", (e) => {
      if (e.target.closest("input, button")) return;
      selectFx(fx.id === selectedFx ? null : fx.id);
    });
    if (folded) { el.appendChild(card); continue; }

    const body = document.createElement("div");
    body.className = "fx-body";
    // Without a face the text is placed freely whatever "anchor" says
    // (see behind-text), so show the free controls, not the face ones.
    const faceless = !v.face && def.schema.some((f) => f.key === "anchor") && fx.params.anchor !== "follow";
    const shown = faceless ? { ...fx.params, anchor: "free" } : fx.params;
    for (const f of def.schema) {
      if (!fieldApplies(def, f, shown)) continue;
      body.appendChild(field(f, shown[f.key], (value, extra = {}) =>
        patch(v.id, fx.id, { params: { ...extra, [f.key]: value } }), fx.id));
    }
    card.appendChild(body);

    // Following people: say how many the clip has, once tracked.
    const follows = fx.type === "person-tags" || fx.params.anchor === "follow";
    if (follows) {
      const n = v.peopleCount;
      const w = document.createElement("div");
      w.className = "hint";
      const want = fx.params.person && fx.params.person !== "all" ? Number(fx.params.person) : 0;
      if (n === undefined) w.textContent = "Le suivi des personnes se calcule à l'aperçu (quelques secondes).";
      else if (!n) { w.className = "hint warn"; w.textContent = "Aucune personne suivie dans ce clip : le texte est placé librement."; }
      else if (want > n) { w.className = "hint warn"; w.textContent = `Ce clip n'a que ${n} personne${n > 1 ? "s" : ""} suivie${n > 1 ? "s" : ""} : choisis-en une autre.`; }
      else w.textContent = `${n} personne${n > 1 ? "s" : ""} suivie${n > 1 ? "s" : ""} dans ce clip, numérotée${n > 1 ? "s" : ""} de gauche à droite.`;
      card.appendChild(w);
    }

    // Anchored on the face, but none was found (seen from behind, far
    // away): the text is placed freely instead — say so.
    if (faceless) {
      const w = document.createElement("div");
      w.className = "hint";
      w.textContent = "Pas de visage détecté (personne de dos, de loin…) : le texte se place librement. Fais-le glisser sur l'aperçu pour le mettre derrière la personne.";
      card.appendChild(w);
    }
    el.appendChild(card);
  }
}

// What the inspector is showing: the clip, or the effect picked on the timeline.
function drawInspectorHead(v) {
  const h = $("#insp-head");
  if (!h) return;
  if (!v) { h.innerHTML = ""; return; }
  const fx = selectedFx && v.effects.find((f) => f.id === selectedFx);
  const def = fx && state.effects.find((e) => e.type === fx.type);
  h.innerHTML = fx
    ? `<b>${escapeHtml(fx.name || def?.label || fx.type)}</b><span>${escapeHtml(def?.label || "")}${def?.timed ? ` · ${fmtTc(Number(fx.start) || 0, v.fps, true)}` : " · tout le clip"}</span><button class="insp-all" title="Afficher tous les effets du clip">Tous les effets</button>`
    : `<b>${escapeHtml(v.name)}</b><span>${fmtTc(v.duration, v.fps, true)} · ${v.width}×${v.height} · ${v.effects.length} effet${v.effects.length > 1 ? "s" : ""}</span>`;
  const all = h.querySelector(".insp-all");
  if (all) all.onclick = () => selectFx(null);
}

// A field can apply only in some modes (showIf: { key, values }): the
// colour of a gradient means nothing once an image is chosen.
function fieldApplies(def, f, params) {
  if (!f.showIf) return true;
  const ruler = def.schema.find((x) => x.key === f.showIf.key);
  const current = params[f.showIf.key] ?? (ruler ? ruler.default : undefined);
  return f.showIf.values.includes(String(current));
}

// One control from a schema entry. Used by both the timeline's effect
// cards and the library's preset editor, so they stay identical.
function field(f, value, onChange, tagId) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = f.label;
  wrap.appendChild(label);
  const tag = (el) => { el.dataset.fx = tagId; el.dataset.key = f.key; return el; };

  if (value === undefined || value === null) value = f.default;
  let input;

  if (f.type === "select") {
    input = document.createElement("select");
    for (const o of f.options) {
      const opt = document.createElement("option");
      opt.value = o.value; opt.textContent = o.label;
      if (String(value) === String(o.value)) opt.selected = true;
      input.appendChild(opt);
    }
    input.onchange = () => onChange(input.value);
    wrap.appendChild(input);
  } else if (f.type === "range") {
    // Slider for feel, number box for precision — and the box accepts
    // values beyond the slider's range when you need to push further.
    const holder = document.createElement("div");
    holder.className = "rangewrap";
    input = document.createElement("input");
    input.type = "range";
    input.min = f.min; input.max = f.max; input.step = f.step; input.value = value;

    const box = document.createElement("input");
    box.type = "number";
    box.className = "val";
    box.step = f.step;
    box.value = Number(value);

    input.oninput = () => { box.value = Number(input.value); };
    input.onchange = () => onChange(Number(input.value));
    box.onchange = () => {
      // valueAsNumber sidesteps locale decimal separators
      const v = box.valueAsNumber;
      if (!Number.isFinite(v)) return;
      input.value = v;
      onChange(v);
    };

    holder.appendChild(input); holder.appendChild(box);
    wrap.appendChild(holder);
  } else if (f.type === "color") {
    // One click links the colour to a role of the project's brand kit
    // ("brand:primary"…): it then follows the kit. The free picker
    // unlinks it.
    const brand = state.brand || { colors: {} };
    const roles = (state.options && state.options.colorRoles) || [];
    const holder = document.createElement("div");
    holder.className = "colorpick";
    const linked = String(value).startsWith("brand:") ? String(value).slice(6) : null;
    input = document.createElement("input");
    input.type = "color";
    input.value = linked ? (brand.colors[linked] || "#ffffff") : value;
    input.title = "Couleur libre";
    input.onchange = () => onChange(input.value);
    holder.appendChild(input);
    for (const role of roles) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "sw" + (linked === role.key ? " on" : "");
      sw.style.background = brand.colors[role.key];
      sw.title = `Charte : ${role.label}`;
      sw.onclick = () => onChange("brand:" + role.key);
      holder.appendChild(sw);
    }
    const tag = document.createElement("span");
    tag.className = "tag";
    const role = roles.find((r) => r.key === linked);
    tag.textContent = role ? `charte · ${role.label.toLowerCase()}` : "libre";
    holder.appendChild(tag);
    wrap.appendChild(holder);
  } else if (f.type === "image") {
    // Pick an image already imported, import a new one (button or drop),
    // and choosing one also switches on the mode it belongs to — an image
    // picked while the effect is on "Dégradé" would otherwise do nothing.
    const extra = f.showIf ? { [f.showIf.key]: f.showIf.values[0] } : {};
    const choose = (file) => onChange(file, extra);

    const holder = document.createElement("div");
    holder.className = "imgpick";
    const row = document.createElement("div");
    row.className = "row";
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (value) thumb.style.backgroundImage = `url("/media/${encodeURIComponent(value)}")`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = value ? "Importer une autre image…" : "Importer une image…";
    input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.hidden = true;

    const upload = async (file) => {
      if (!file) return;
      button.disabled = true;
      button.textContent = "Envoi…";
      try {
        const { file: stored } = await api("/api/assets", {
          method: "POST",
          headers: { "x-filename": encodeURIComponent(file.name) },
          body: file,
        });
        assetList.unshift({ file: stored });
        choose(stored);
      } finally {
        button.disabled = false;
      }
    };
    button.onclick = () => input.click();
    input.onchange = () => upload(input.files && input.files[0]);

    // Dropping an image file on the field imports it too.
    holder.addEventListener("dragover", (e) => { e.preventDefault(); holder.classList.add("drag"); });
    holder.addEventListener("dragleave", () => holder.classList.remove("drag"));
    holder.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      holder.classList.remove("drag");
      const file = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
      upload(file);
    });

    row.append(thumb, button, input);
    holder.appendChild(row);

    if (assetList.length) {
      const gallery = document.createElement("div");
      gallery.className = "gallery";
      for (const asset of assetList.slice(0, 12)) {
        const pick = document.createElement("button");
        pick.type = "button";
        pick.title = "Utiliser cette image";
        pick.className = asset.file === value ? "on" : "";
        pick.style.backgroundImage = `url("/media/${encodeURIComponent(asset.file)}")`;
        pick.onclick = () => { if (asset.file !== value) choose(asset.file); };
        gallery.appendChild(pick);
      }
      holder.appendChild(gallery);
    }
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.textContent = assetList.length
      ? "Clique une image déjà importée, ou glisse-en une nouvelle ici."
      : "PNG, JPEG ou WebP — ou glisse l'image ici.";
    if (f.brandLogo) {
      // Empty means "the brand's logo"; say which one that is.
      if (value) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = "Utiliser le logo de la charte";
        reset.style.fontSize = "12px";
        reset.onclick = () => onChange("");
        holder.appendChild(reset);
      } else {
        tip.textContent = state.brand && state.brand.logo
          ? "Logo de la charte « " + state.brand.name + " ». Choisis une autre image pour le remplacer ici."
          : "Aucun logo dans la charte de ce projet : importe-le dans « Charte graphique », ou choisis une image ici.";
        if (state.brand && state.brand.logo) {
          thumb.style.backgroundImage = `url("/media/${encodeURIComponent(state.brand.logo)}")`;
        }
      }
    }
    holder.appendChild(tip);
    wrap.appendChild(holder);
  } else {
    input = document.createElement("input");
    input.type = f.type === "number" ? "number" : "text";
    if (f.step !== undefined) input.step = f.step;
    if (f.min !== undefined) input.min = f.min;
    input.value = value;
    input.onchange = () =>
      onChange(f.type === "number" ? Number(input.value) : input.value);
    wrap.appendChild(input);
  }
  // Tag every control so refresh() can put the caret back where it was.
  wrap.querySelectorAll("input, select").forEach(tag);
  return wrap;
}

// Coalesce bursts of edits — arrow keys on a number box fire one change
// each, and every one of them would otherwise trigger a full rebuild.
const pending = new Map();
let patchTimer = null;

async function patch(videoId, fxId, body) {
  const key = `${videoId}:${fxId}`;
  const merged = pending.get(key) || { params: {} };
  if (body.params) merged.params = { ...merged.params, ...body.params };
  if (body.enabled !== undefined) merged.enabled = body.enabled;
  if (body.name !== undefined) merged.name = body.name;
  if (body.start !== undefined) merged.start = body.start;
  if (body.duration !== undefined) merged.duration = body.duration;
  pending.set(key, merged);

  clearTimeout(patchTimer);
  patchTimer = setTimeout(async () => {
    const jobs = [...pending.entries()];
    pending.clear();
    try {
      for (const [k, payload] of jobs) {
        const [vid, fid] = k.split(":");
        await api(`/api/videos/${vid}/effects/${fid}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    } catch (error) {
      return setStatus(error.message, true);
    }
    await refresh();
    preview();
  }, 220);
}

// ------------------------------------------------------------ preview

function clearFrame() {
  $("#frame").innerHTML = '<div class="empty">Ajoute une vidéo pour commencer.</div>';
  $("#tl").hidden = true;
  for (const id of ["play", "restart", "refresh", "render", "trim-open", "step-back", "step-fwd"]) $("#" + id).disabled = true;
}

// The container must be passed in: the library has its own frame, and a
// hidden one measures zero, which would scale the iframe to nothing.
// The preview is the output canvas, whose size depends on the format —
// so it is read from the composition itself once it has loaded.
function fitFrame(iframe, v, host) {
  let w = v ? v.width : 1280;
  let h = v ? v.height : 720;
  try {
    const root = iframe.contentDocument.getElementById("root");
    if (root && root.dataset.width) { w = +root.dataset.width; h = +root.dataset.height; }
  } catch { /* not loaded yet */ }
  const box = (host || iframe.parentElement || $("#frame")).getBoundingClientRect();
  const scale = Math.min(box.width / w, box.height / h);
  iframe.style.width = w + "px";
  iframe.style.height = h + "px";
  iframe.style.transform = `scale(${scale})`;
}

// Where the preview currently sits, so an edit does not send the viewer
// back to frame 0.
function currentPreviewTime() {
  try {
    const w = $("#frame iframe").contentWindow;
    return w.__studioTime ? w.__studioTime() : 0;
  } catch {
    return 0;
  }
}

const setBusy = (on) => $("#frame").classList.toggle("busy", on);

// A moment where the effect actually reads: past its entrance, but still
// inside its window.
function showcaseTime(v, fx) {
  const start = Number(fx.start) || 0;
  const dur = fx.duration == null ? Math.max(0.1, v.duration - start) : Number(fx.duration);
  const entry = Number(fx.params?.reveal ?? 0.5) + 0.25;
  return Math.min(start + Math.max(entry, dur * 0.35), start + dur * 0.75, v.duration - 0.05);
}

let previewToken = 0;
async function preview(opts = {}) {
  const v = videoById(selected);
  if (!v) return;
  const token = ++previewToken;
  const at = opts.at !== undefined ? opts.at : currentPreviewTime();

  setBusy(true);
  $("#prog").hidden = false;
  try {
    const { job } = await api(`/api/videos/${v.id}/prepare`, { method: "POST" });
    const done = await waitJob(job.id);
    // The first preview of a following effect tracks the people: the
    // cards then say how many were found.
    if (done.result && done.result.peopleCount != null && done.result.peopleCount !== v.peopleCount) await refresh();
  } catch (error) {
    setBusy(false);
    $("#prog").hidden = true;
    return setStatus(error.message, true);
  }
  if (token !== previewToken) return;

  $("#prog").hidden = true;
  setStatus("");
  const frame = $("#frame");
  frame.innerHTML = "";
  frame.classList.add("busy");
  const iframe = document.createElement("iframe");
  iframe.src = `/preview/${v.id}?v=${Date.now()}#t=${at.toFixed(3)}`;
  iframe.onload = () => fitFrame(iframe, v, frame);
  frame.appendChild(iframe);
  fitFrame(iframe, v, frame);
  playing = false;
  $("#play").textContent = "▶";
  for (const id of ["play", "restart", "refresh", "render", "trim-open", "step-back", "step-fwd"]) $("#" + id).disabled = false;
  // The iframe tells us once it has actually landed on `at`.
  setTimeout(() => setBusy(false), 2500);
}

window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "ready") {
    setBusy(false);
    // The canvas size is only known once the composition has loaded.
    const iframe = $("#frame iframe");
    if (iframe) fitFrame(iframe, videoById(selected), $("#frame"));
  }
  if (e.data && e.data.type === "ended") {
    playing = false;
    $("#play").textContent = "▶";
  }
});

function post(msg) {
  const iframe = $("#frame iframe");
  if (iframe) iframe.contentWindow.postMessage(msg, "*");
}

// --------------------------------------------------------------- jobs

function setStatus(text, isError) {
  const el = $("#status");
  el.className = "status" + (isError ? " err" : "");
  el.innerHTML = text;
}

function waitJob(id) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let job;
      try { job = await api(`/api/jobs/${id}`); } catch (e) { return reject(e); }
      $("#prog").value = job.progress || 0;
      if (job.message) setStatus(job.message);
      if (job.status === "done") return resolve(job);
      if (job.status === "error") return reject(new Error(job.error));
      setTimeout(tick, 350);
    };
    tick();
  });
}


// ----------------------------------------------------------- timeline

const SNAP = 0.05;
const snap = (v) => Math.round(v / SNAP) * SNAP;

// Laid out like the Final Cut timeline: the clip is the primary storyline
// (filmstrip + audio waveform) at the bottom; each timed effect is a
// connected clip in its own lane above it, coloured by family (titles
// purple, animations pink, image treatments teal); whole-clip effects sit on
// the clip as badges; subtitles are a lane at the top. Everything is placed
// in % of the clip, inside #tl-inner whose width is the zoom.
let selectedFx = null;
const FX_FAMILY = { Textes: "text", Animations: "anim", Image: "image" };

function fxFamily(def) { return FX_FAMILY[def?.category] || "text"; }

function drawTimeline() {
  const tl = $("#tl");
  const body = $("#tl-body");
  const v = videoById(selected);
  body.innerHTML = "";
  $("#tl-none").hidden = Boolean(v);
  if (!v) { tl.hidden = true; return; }
  tl.hidden = false;
  if (selectedFx && !v.effects.some((f) => f.id === selectedFx)) selectedFx = null;
  const pct = (t) => (t / v.duration) * 100 + "%";

  // ruler: time code every few seconds, adapted to the zoom
  const ruler = document.createElement("div");
  ruler.className = "tl-ruler tl-track";
  const zoom = Number($("#tl-zoom")?.value || 1);
  const width = (tl.clientWidth || 800) * zoom;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const stepSec = steps.find((st) => (st / v.duration) * width >= 70) || 300;
  for (let t = 0; t < v.duration - 0.01; t += stepSec) {
    const tick = document.createElement("div");
    tick.className = "tl-tick";
    tick.style.left = pct(t);
    tick.textContent = fmtTc(t, v.fps, true);
    ruler.appendChild(tick);
  }
  body.appendChild(ruler);

  // subtitles lane
  const cues = v.captions?.cues || [];
  if (cues.length) {
    const lane = document.createElement("div");
    lane.className = "lane cc tl-track";
    for (const c of cues) {
      const b = document.createElement("div");
      b.className = "cc-block";
      b.style.left = pct(c.start);
      b.style.width = pct(Math.max(0.05, c.end - c.start));
      b.textContent = c.text;
      b.title = `${fmtTime(c.start)} → ${fmtTime(c.end)} · ${c.text}`;
      b.onclick = (e) => { e.stopPropagation(); post({ type: "seek", t: c.start + 0.01 }); showRightPanel("cc"); };
      lane.appendChild(b);
    }
    body.appendChild(lane);
  }

  // connected clips: timed effects, the first one closest to the storyline
  const timed = v.effects.filter((fx) => state.effects.find((e) => e.type === fx.type)?.timed);
  for (const fx of [...timed].reverse()) {
    const def = state.effects.find((e) => e.type === fx.type);
    const lane = document.createElement("div");
    lane.className = "lane tl-track" + (fx.enabled === false ? " off" : "");
    const start = Number(fx.start) || 0;
    const dur = fx.duration == null ? Math.max(0.1, v.duration - start) : Number(fx.duration);
    const bar = document.createElement("div");
    bar.className = `tl-bar fam-${fxFamily(def)}` + (fx.id === selectedFx ? " sel" : "");
    bar.dataset.fx = fx.id;
    bar.style.left = pct(start);
    bar.style.width = pct(dur);
    bar.innerHTML = `<span class="lbl">${escapeHtml(fx.name || def.label)}</span><span class="tm">${fmtTc(start, v.fps, true)} → ${fmtTc(start + dur, v.fps, true)}</span><span class="tl-h l"></span><span class="tl-h r"></span>`;
    bar.title = `${fx.name || def.label} — ${def.label}\nGlisse pour déplacer, tire un bord pour rallonger · clic : inspecter`;
    attachDrag(bar, lane, v, fx);
    lane.appendChild(bar);
    body.appendChild(lane);
  }

  // primary storyline: the clip
  const story = document.createElement("div");
  story.className = "lane story tl-track";
  const clip = document.createElement("div");
  clip.className = "clip-bar";
  clip.innerHTML = `<div class="film"></div><div class="clip-lbl">${escapeHtml(v.name)}</div><div class="fx-badges"></div>${v.hasAudio ? '<canvas class="wave"></canvas>' : ""}`;
  clipThumb(v).then((url) => { if (url) clip.querySelector(".film").style.backgroundImage = `url(${url})`; });
  const badges = clip.querySelector(".fx-badges");
  for (const fx of v.effects.filter((f) => !timed.includes(f))) {
    const def = state.effects.find((e) => e.type === fx.type);
    if (!def) continue;
    const b = document.createElement("button");
    b.className = `fx-badge fam-${fxFamily(def)}` + (fx.id === selectedFx ? " sel" : "") + (fx.enabled === false ? " off" : "");
    b.textContent = `✦ ${fx.name || def.label}`;
    b.title = `${fx.name || def.label} : s'applique à tout le clip · clic : inspecter`;
    b.onpointerdown = (e) => e.stopPropagation();
    b.onclick = (e) => { e.stopPropagation(); selectFx(fx.id); };
    badges.appendChild(b);
  }
  if (v.hasAudio && typeof drawWave === "function") drawWave(v, clip.querySelector(".wave"));
  story.appendChild(clip);
  body.appendChild(story);
  // Like Final Cut, keep the storyline in view: scroll to the bottom lanes.
  requestAnimationFrame(() => { tl.scrollTop = tl.scrollHeight; });

  if (!v.effects.length) {
    const none = document.createElement("div");
    none.className = "tl-empty";
    none.textContent = "Aucun effet : ⌘5 ou « ✦ Effets » pour en ajouter un à la tête de lecture.";
    body.appendChild(none);
  }
}

// Select an effect (timeline click): the inspector opens it, the others fold.
function selectFx(id) {
  selectedFx = id;
  showRightPanel("fx");
  for (const b of document.querySelectorAll("#tl [data-fx], #tl .fx-badge")) b.classList.remove("sel");
  drawTimeline();
  drawStack();
  const card = id && document.querySelector(`.fx[data-fx="${id}"]`);
  if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function seekFromPointer(e, track, v) {
  const r = track.getBoundingClientRect();
  const t = Math.max(0, Math.min(((e.clientX - r.left) / r.width) * v.duration, v.duration));
  post({ type: "seek", t });
  return t;
}

// Drag the bar to move it, drag an edge to trim it. The DOM updates live;
// the server is only told once the pointer is released.
function attachDrag(bar, track, v, fx) {
  bar.addEventListener("pointerdown", (e) => {
    const handle = e.target.classList.contains("tl-h")
      ? (e.target.classList.contains("l") ? "l" : "r")
      : "move";
    e.preventDefault();
    e.stopPropagation();
    // Without capture the drag dies the moment the pointer crosses the
    // preview iframe, which swallows the events.
    try { bar.setPointerCapture(e.pointerId); } catch { /* not critical */ }

    const rect = track.getBoundingClientRect();
    const perSec = rect.width / v.duration;
    const startX = e.clientX;
    const start0 = Number(fx.start) || 0;
    const dur0 = fx.duration == null
      ? Math.max(0.1, v.duration - start0)
      : Number(fx.duration);

    let start = start0;
    let dur = dur0;

    const onMove = (ev) => {
      const delta = (ev.clientX - startX) / perSec;
      if (handle === "move") {
        start = snap(Math.max(0, Math.min(start0 + delta, v.duration - dur0)));
        dur = dur0;
      } else if (handle === "l") {
        const limit = start0 + dur0 - 0.1;
        start = snap(Math.max(0, Math.min(start0 + delta, limit)));
        dur = snap(start0 + dur0 - start);
      } else {
        dur = snap(Math.max(0.1, Math.min(dur0 + delta, v.duration - start0)));
        start = start0;
      }
      bar.style.left = (start / v.duration) * 100 + "%";
      bar.style.width = (dur / v.duration) * 100 + "%";
      const tm = bar.querySelector(".tm");
      if (tm) tm.textContent = `${fmtTc(start, v.fps, true)} → ${fmtTc(start + dur, v.fps, true)}`;
    };

    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try { bar.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      if (Math.abs(start - start0) < 0.001 && Math.abs(dur - dur0) < 0.001) { selectFx(fx.id); return; }
      await api(`/api/videos/${v.id}/effects/${fx.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start,
          duration: Math.abs(start + dur - v.duration) < 0.02 ? null : dur,
        }),
      });
      await refresh();
      preview();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

