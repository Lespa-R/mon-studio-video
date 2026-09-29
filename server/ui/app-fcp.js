// Mon Studio Vidéo — interface (app-fcp.js).
// Final Cut Pro habits: timecode, skimming, timeline zoom, showing / hiding
// the browser, timeline and inspector, the effects browser, the audio
// waveform, and the keyboard shortcuts Robin already knows.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ------------------------------------------------------------ timecode

let skimming = null; // { t0 } while the pointer skims the timeline

function onPlayhead(t, duration) {
  const v = videoById(selected);
  if (!v) { $("#timecode").textContent = fmtTc(0); $("#tc-dur").textContent = ""; return; }
  if (!skimming) $("#timecode").textContent = fmtTc(t ?? 0, v.fps);
  $("#tc-dur").textContent = `/ ${fmtTc(v.duration, v.fps)}`;
}

function drawViewerHead() {
  const v = videoById(selected);
  const f = state.format || {};
  $("#viewer-name").textContent = v ? v.name : "";
  $("#tl-proj").textContent = v ? `${state.activeProjectName || "Projet"} · ${v.name}` : (state.activeProjectName || "");
  if (!v) { $("#viewer-info").textContent = ""; return; }
  const aspect = (state.options?.aspects || []).find((a) => a.value === f.aspect)?.label;
  $("#viewer-info").textContent = `${aspect && f.aspect !== "source" ? aspect : `${v.width}×${v.height}`} · ${Math.round(v.fps || 30)} i/s`;
}

// ------------------------------------------------------------ skimming

// Like Final Cut: moving over the timeline shows that frame in the viewer
// (red line); leaving it goes back to the playhead; a click moves the playhead.
let skimOn = true;
try { skimOn = localStorage.getItem("studio.skim") !== "0"; } catch { /* private mode */ }
$("#skim-btn").classList.toggle("on", skimOn);

let skimTimer = 0;
function skimTo(e) {
  const v = videoById(selected);
  const inner = $("#tl-inner");
  if (!v || !inner) return null;
  const r = inner.getBoundingClientRect();
  const t = Math.max(0, Math.min(((e.clientX - r.left) / r.width) * v.duration, v.duration));
  const line = $("#tl-skim");
  line.style.display = "block";
  line.style.left = (t / v.duration) * 100 + "%";
  return t;
}

$("#tl-inner").addEventListener("pointermove", (e) => {
  if (e.buttons) return; // dragging a clip
  const v = videoById(selected);
  const t = skimTo(e);
  if (t === null || !skimOn || playing) return;
  if (!skimming) skimming = { t0: currentPreviewTime() };
  $("#timecode").textContent = fmtTc(t, v.fps);
  $("#timecode").classList.add("skim");
  const now = performance.now();
  if (now - skimTimer > 40) { skimTimer = now; post({ type: "seek", t }); }
});
$("#tl-inner").addEventListener("pointerleave", () => {
  $("#tl-skim").style.display = "none";
  $("#timecode").classList.remove("skim");
  if (skimming) { post({ type: "seek", t: skimming.t0 }); skimming = null; }
});
// A click on empty timeline space moves the playhead there and clears the selection.
$("#tl-inner").addEventListener("pointerdown", (e) => {
  if (e.target.closest(".tl-bar, .fx-badge, .cc-block, .tl-h")) return;
  const v = videoById(selected);
  const inner = $("#tl-inner");
  if (!v) return;
  const r = inner.getBoundingClientRect();
  const t = Math.max(0, Math.min(((e.clientX - r.left) / r.width) * v.duration, v.duration));
  post({ type: "seek", t });
  skimming = null;
  if (selectedFx) selectFx(null);
});

function toggleSkim() {
  skimOn = !skimOn;
  $("#skim-btn").classList.toggle("on", skimOn);
  try { localStorage.setItem("studio.skim", skimOn ? "1" : "0"); } catch { /* private mode */ }
  toast(skimOn ? "Survol activé (S)" : "Survol désactivé (S)");
}
$("#skim-btn").onclick = toggleSkim;

// ---------------------------------------------------------------- zoom

function setZoom(z, anchorT) {
  const input = $("#tl-zoom");
  const v = videoById(selected);
  const tl = $("#tl");
  const old = Number(input.value);
  z = Math.max(Number(input.min), Math.min(Number(input.max), z));
  input.value = z;
  $("#tl-inner").style.width = z * 100 + "%";
  // Keep the playhead where it was on screen.
  if (v && tl.clientWidth) {
    const t = anchorT ?? currentPreviewTime();
    const x = (t / v.duration) * tl.clientWidth * old - tl.scrollLeft;
    tl.scrollLeft = Math.max(0, (t / v.duration) * tl.clientWidth * z - x);
  }
  drawTimeline();
}
$("#tl-zoom").oninput = () => setZoom(Number($("#tl-zoom").value));
$("#zoom-in").onclick = () => setZoom(Number($("#tl-zoom").value) * 1.5);
$("#zoom-out").onclick = () => setZoom(Number($("#tl-zoom").value) / 1.5);
// Pinch / ⌘-scroll zooms, as on a trackpad in Final Cut.
$("#tl").addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom(Number($("#tl-zoom").value) * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
}, { passive: false });

// ------------------------------------------------- show / hide the areas

let areas = { browser: true, timeline: true, inspector: true };
try { areas = { ...areas, ...JSON.parse(localStorage.getItem("studio.areas") || "{}") }; } catch { /* private mode */ }

function applyAreas() {
  const edit = $("#view-edit");
  edit.classList.toggle("no-browser", !areas.browser);
  edit.classList.toggle("no-timeline", !areas.timeline);
  edit.classList.toggle("no-inspector", !areas.inspector);
  $("#show-browser").classList.toggle("on", areas.browser);
  $("#show-timeline").classList.toggle("on", areas.timeline);
  $("#show-inspector").classList.toggle("on", areas.inspector);
  try { localStorage.setItem("studio.areas", JSON.stringify(areas)); } catch { /* private mode */ }
  applyLayout();
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}
const toggleArea = (k) => { areas[k] = !areas[k]; applyAreas(); };
$("#show-browser").onclick = () => toggleArea("browser");
$("#show-timeline").onclick = () => toggleArea("timeline");
$("#show-inspector").onclick = () => toggleArea("inspector");

// ------------------------------------------------------- effects browser

// Final Cut's effects browser: categories on the left, a tile per effect.
// A click shows what it does; a double-click (or « Ajouter ») puts it on the
// clip at the playhead; a tile can also be dropped on the timeline.
let fxbCat = "Tous";
const FAM_ICON = { text: "T", anim: "✦", image: "◐" };

function drawEffectsBrowser() {
  const cats = ["Tous", ...effectsByCategory().map(([c]) => c), ...(state.presets.length ? ["Mes préréglages"] : [])];
  if (!cats.includes(fxbCat)) fxbCat = "Tous";
  const catEl = $("#fxb-cats");
  catEl.innerHTML = "";
  for (const c of cats) {
    const b = document.createElement("button");
    b.textContent = c;
    b.className = c === fxbCat ? "on" : "";
    b.onclick = () => { fxbCat = c; drawEffectsBrowser(); };
    catEl.appendChild(b);
  }
  const q = $("#fxb-search").value.trim().toLowerCase();
  const items = [];
  if (fxbCat !== "Mes préréglages") {
    for (const e of state.effects) {
      if (fxbCat !== "Tous" && (e.category || "Effets") !== fxbCat) continue;
      items.push({ value: "type:" + e.type, label: e.label, hint: e.hint, fam: fxFamily(e) });
    }
  }
  if (fxbCat === "Tous" || fxbCat === "Mes préréglages") {
    for (const p of state.presets) {
      const def = state.effects.find((e) => e.type === p.type);
      items.push({ value: "preset:" + p.id, label: "★ " + p.name, hint: def ? `Ton préréglage, basé sur « ${def.label} ».` : "", fam: fxFamily(def) });
    }
  }
  const grid = $("#fxb-grid");
  grid.innerHTML = "";
  for (const it of items.filter((x) => !q || x.label.toLowerCase().includes(q) || (x.hint || "").toLowerCase().includes(q))) {
    const tile = document.createElement("div");
    tile.className = `fxb-tile fam-${it.fam}` + ($("#fx-type").value === it.value ? " on" : "");
    tile.draggable = true;
    tile.innerHTML = `<div class="ic">${FAM_ICON[it.fam] || "✦"}</div><div class="nm">${escapeHtml(it.label)}</div>`;
    tile.title = it.hint || it.label;
    const pick = () => {
      $("#fx-type").value = it.value;
      showEffectHint();
      for (const t of grid.children) t.classList.toggle("on", t === tile);
    };
    tile.onclick = pick;
    tile.ondblclick = () => { pick(); addPicked(); };
    tile.ondragstart = (e) => { pick(); e.dataTransfer.setData("text/x-studio-fx", it.value); e.dataTransfer.effectAllowed = "copy"; };
    grid.appendChild(tile);
  }
  if (!grid.children.length) grid.innerHTML = '<div class="none">Aucun effet ne correspond.</div>';
}

function addPicked(at) {
  if (!selected) return toast("Sélectionne d'abord un clip.");
  if (!$("#fx-type").value) return;
  if (at !== undefined) post({ type: "seek", t: at });
  // Give the preview a moment to land on the drop point before reading it.
  setTimeout(() => $("#fx-add").click(), at !== undefined ? 120 : 0);
}

function toggleEffectsBrowser(show) {
  const fxb = $("#fxb");
  fxb.hidden = show === undefined ? !fxb.hidden : !show;
  $("#fxb-btn").classList.toggle("on", !fxb.hidden);
  if (!fxb.hidden) {
    if (!areas.timeline) { areas.timeline = true; applyAreas(); }
    drawEffectsBrowser();
    $("#fxb-search").focus();
  }
}
$("#fxb-btn").onclick = () => toggleEffectsBrowser();
$("#fxb-open").onclick = () => toggleEffectsBrowser(true);
$("#fxb-search").oninput = drawEffectsBrowser;
$("#fxb-search").onkeydown = (e) => {
  if (e.key === "Escape") { e.stopPropagation(); toggleEffectsBrowser(false); }
  if (e.key === "Enter") { const first = $("#fxb-grid .fxb-tile"); if (first) first.ondblclick(); }
};

// Drop a tile on the timeline: the effect starts where it was dropped.
$("#tl").addEventListener("dragover", (e) => {
  if (![...e.dataTransfer.types].includes("text/x-studio-fx")) return;
  e.preventDefault();
  skimTo(e);
});
$("#tl").addEventListener("drop", (e) => {
  const value = e.dataTransfer.getData("text/x-studio-fx");
  if (!value) return;
  e.preventDefault();
  e.stopPropagation();
  $("#fx-type").value = value;
  const t = skimTo(e);
  $("#tl-skim").style.display = "none";
  addPicked(t ?? undefined);
});

// --------------------------------------------------------- audio waveform

// The clip's sound drawn under its filmstrip, as in the Final Cut storyline.
// Decoded once per clip in the browser (Web Audio), kept for the session.
const waveCache = new Map();
function clipPeaks(v) {
  const key = `${v.id}:${v.trim ? `${v.trim.start}-${v.trim.end}` : ""}`;
  if (!waveCache.has(key)) {
    waveCache.set(key, (async () => {
      try {
        const buf = await fetch(`/media/${encodeURIComponent(`${v.id}-bg${v.ext}`)}`).then((r) => r.arrayBuffer());
        const ctx = new OfflineAudioContext(1, 1, 8000);
        const audio = await ctx.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const n = 600;
        const step = Math.max(1, Math.floor(data.length / n));
        const peaks = new Float32Array(n);
        let max = 0.0001;
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 4) m = Math.max(m, Math.abs(data[j]));
          peaks[i] = m;
          max = Math.max(max, m);
        }
        return peaks.map((p) => p / max);
      } catch { return null; }
    })());
  }
  return waveCache.get(key);
}

function drawWave(v, canvas) {
  if (!canvas) return;
  clipPeaks(v).then((peaks) => {
    if (!peaks || !canvas.isConnected) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, h * dpr);
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.fillStyle = "rgba(170, 240, 190, .85)";
    const n = peaks.length;
    for (let x = 0; x < w; x++) {
      const p = peaks[Math.min(n - 1, Math.floor((x / w) * n))];
      const bh = Math.max(1, p * (h - 2));
      g.fillRect(x, h - 1 - bh, 1, bh);
    }
  });
}

// ------------------------------------------------------ transport buttons

const frameStep = (n) => {
  const v = videoById(selected);
  if (!v) return;
  if (playing) $("#play").click();
  const t = Math.max(0, Math.min(currentPreviewTime() + n / (v.fps || 30), v.duration));
  post({ type: "seek", t });
};
$("#step-back").onclick = () => frameStep(-1);
$("#step-fwd").onclick = () => frameStep(1);
$("#import-btn").onclick = () => $("#file").click();

// --------------------------------------------------------- shortcuts

const SHORTCUTS = [
  ["Espace", "Lecture / pause"],
  ["J · K · L", "Reculer d'1 s · pause · lecture"],
  ["← →", "Image précédente / suivante"],
  ["⇧← ⇧→", "10 images en arrière / en avant"],
  ["Début · Fin", "Aller au début / à la fin du clip"],
  ["S", "Survol de la timeline (activer / désactiver)"],
  ["⌘+ · ⌘− · ⇧Z", "Zoomer · dézoomer · toute la timeline"],
  ["⌘5", "Navigateur d'effets"],
  ["⌘4 · ⌃⌘1 · ⌃⌘2", "Inspecteur · navigateur · timeline"],
  ["V", "Activer / désactiver l'effet sélectionné"],
  ["⌫", "Supprimer l'effet sélectionné"],
  ["⌘C · ⌘V", "Copier / coller les effets du clip"],
  ["⌘I · ⌘E", "Importer · Partager (rendre le MP4)"],
  ["Échap", "Désélectionner"],
];

function showShortcuts() {
  dialog({
    title: "Raccourcis clavier (comme dans Final Cut Pro)",
    message: SHORTCUTS.map(([k, d]) => `${k}  —  ${d}`).join("\n"),
    okLabel: "Fermer",
  });
}
$("#keys-help").onclick = showShortcuts;

document.addEventListener("keydown", async (e) => {
  if (!$("#dlg").hidden || !$("#trim").hidden || $("#view-edit").hidden) return;
  const el = document.activeElement;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(el?.tagName) && el.type !== "range" && el.type !== "checkbox";
  if (typing) return;
  const cmd = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const v = videoById(selected);
  const ready = v && !$("#play").disabled;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };

  if (cmd && e.ctrlKey && e.metaKey && k === "1") { stop(); return toggleArea("browser"); }
  if (cmd && e.ctrlKey && e.metaKey && k === "2") { stop(); return toggleArea("timeline"); }
  if (cmd && k === "4") { stop(); return toggleArea("inspector"); }
  if (cmd && k === "5") { stop(); return toggleEffectsBrowser(); }
  if (cmd && k === "i") { stop(); return $("#file").click(); }
  if (cmd && k === "e") { stop(); if (!$("#render").disabled) $("#render").click(); return; }
  if (cmd && (k === "=" || k === "+")) { stop(); return setZoom(Number($("#tl-zoom").value) * 1.5); }
  if (cmd && k === "-") { stop(); return setZoom(Number($("#tl-zoom").value) / 1.5); }
  if (cmd && k === "c" && v && !window.getSelection()?.toString()) { stop(); return $("#fx-copy").click(); }
  if (cmd && k === "v" && v && !$("#fx-paste").hidden) { stop(); return $("#fx-paste").click(); }
  if (cmd || e.altKey) return;

  if (e.key === "?") { stop(); return showShortcuts(); }
  if (e.shiftKey && k === "z") { stop(); $("#tl").scrollLeft = 0; return setZoom(1); }
  if (k === "s" && !e.shiftKey) { stop(); return toggleSkim(); }
  if (e.key === "Escape" && selectedFx) { stop(); return selectFx(null); }
  if (!ready) return;
  if (e.code === "Space") { stop(); return $("#play").click(); }
  if (k === "k") { stop(); if (playing) $("#play").click(); return; }
  if (k === "l") { stop(); if (!playing) $("#play").click(); return; }
  if (k === "j") { stop(); if (playing) $("#play").click(); return post({ type: "seek", t: Math.max(0, currentPreviewTime() - 1) }); }
  if (e.key === "ArrowLeft") { stop(); return frameStep(e.shiftKey ? -10 : -1); }
  if (e.key === "ArrowRight") { stop(); return frameStep(e.shiftKey ? 10 : 1); }
  if (e.key === "Home") { stop(); return post({ type: "seek", t: 0 }); }
  if (e.key === "End") { stop(); return post({ type: "seek", t: Math.max(0, v.duration - 1 / (v.fps || 30)) }); }
  const fx = selectedFx && v.effects.find((f) => f.id === selectedFx);
  if (fx && k === "v") {
    stop();
    await patch(v.id, fx.id, { enabled: fx.enabled === false });
    return;
  }
  if (fx && (e.key === "Backspace" || e.key === "Delete")) {
    stop();
    const def = state.effects.find((d) => d.type === fx.type);
    if (!(await askConfirm("Supprimer l'effet", `Retirer « ${fx.name || def?.label || fx.type} » de ce clip ?`, "Supprimer"))) return;
    await api(`/api/videos/${v.id}/effects/${fx.id}`, { method: "DELETE" });
    selectedFx = null;
    await refresh();
    preview();
  }
}, true);

// Redraw what depends on the clip whenever the rest of the page does.
const _drawTimeline = drawTimeline;
drawTimeline = function () { _drawTimeline(); drawViewerHead(); if (!$("#fxb").hidden) drawEffectsBrowser(); };
applyAreas();
