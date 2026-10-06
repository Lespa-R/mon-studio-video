// Mon Studio Vidéo — interface (app-main.js).
// Clipboard, wiring, resizable layout, boot.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ============================================ copy effects between clips

// The clipboard holds the effects as data, not a reference to their clip:
// a copy survives its source clip being deleted, and pastes across
// projects. Kept in sessionStorage so a reload does not lose it.
let clipboard = null;

// The project this tab has open. The server also remembers a "last
// opened" project, but that one is shared by every tab: if it decided
// what an open tab shows, switching project anywhere — another tab, a
// script — would silently swap this tab's clips under the user's cursor.
let assetList = [];
let currentProject = null;
try { currentProject = sessionStorage.getItem("studio.project"); } catch { /* private mode */ }
function openProject(id) {
  currentProject = id;
  try { sessionStorage.setItem("studio.project", id || ""); } catch { /* private mode */ }
}
try {
  clipboard = JSON.parse(sessionStorage.getItem("studio.clipboard") || "null");
} catch {
  clipboard = null;
}

function setClipboard(value) {
  clipboard = value;
  try { sessionStorage.setItem("studio.clipboard", JSON.stringify(value)); } catch { /* private mode */ }
  drawClipbar();
}

const effectData = (fx) => ({
  type: fx.type,
  name: fx.name || null,
  enabled: fx.enabled !== false,
  start: fx.start ?? 0,
  duration: fx.duration ?? null,
  params: { ...fx.params },
});

// ⌘D: a copy of the effect, same settings and timing, selected.
async function duplicateFx(v, fxId) {
  const fx = v.effects.find((f) => f.id === fxId);
  if (!fx) return;
  try {
    await flushPatches();
    const { video } = await api(`/api/videos/${v.id}/effects/paste`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ effects: [effectData(fx)] }),
    });
    await refresh();
    selectFx(video.effects[video.effects.length - 1].id);
    setStatus("Effet dupliqué.");
    preview();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function drawClipbar() {
  const v = videoById(selected);
  $("#fx-copy").disabled = !v || !v.effects.length;
  const paste = $("#fx-paste");
  const note = $("#clip-note");
  paste.hidden = !clipboard;
  paste.disabled = !v;
  note.hidden = !clipboard;
  if (clipboard) {
    const n = clipboard.effects.length;
    paste.textContent = `Coller ${n} effet${n > 1 ? "s" : ""}`;
    note.textContent = `Presse-papiers : ${clipboard.from}`;
  }
  // The cut-out choice only matters to clips with an effect that uses it.
  const usesMatte = v && v.effects.some((fx) =>
    fx.enabled !== false && state.effects.find((e) => e.type === fx.type)?.needsMatte);
  $("#matte-pick").hidden = !usesMatte;
  if (usesMatte) {
    fillCutoutMenu();
    const choice = cutoutChoiceOf(v);
    $("#matte-model").value = choice;
    $("#matte-obj").hidden = !choiceDef(choice)?.object;
  }
}

$("#matte-model").onchange = async (e) => {
  const v = videoById(selected);
  if (!v) return;
  const choice = e.target.value;
  // An object choice with no object yet: pick it first (app-object.js).
  if (choiceDef(choice)?.object && !v.matteOptions?.object) {
    e.target.value = cutoutChoiceOf(v);
    return openObject(v, choice);
  }
  try {
    await api(`/api/videos/${v.id}/matte`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice }),
    });
    setStatus("Nouvelle découpe : recalcul de l'aperçu…");
    await refresh();
    await preview();
  } catch (error) {
    setStatus(error.message, true);
    await refresh();
  }
};

$("#fx-copy").onclick = () => {
  const v = videoById(selected);
  if (!v || !v.effects.length) return;
  setClipboard({ from: v.name, fromId: v.id, effects: v.effects.map(effectData) });
  setStatus(`${v.effects.length} effet(s) copié(s). Sélectionne un autre clip et colle-les.`);
};

$("#fx-paste").onclick = async () => {
  const v = videoById(selected);
  if (!v || !clipboard) return;
  let replace = false;
  if (v.effects.length) {
    const answer = await dialog({
      title: `Coller sur « ${v.name} »`,
      message: `Ce clip a déjà ${v.effects.length} effet${v.effects.length > 1 ? "s" : ""}.`,
      choices: [
        { value: "append", label: "Les ajouter à la suite" },
        { value: "replace", label: "Remplacer les effets actuels" },
      ],
      choiceLabel: "Et les effets existants ?",
      choiceValue: "append",
      okLabel: "Coller",
    });
    if (!answer) return;
    replace = answer.choice === "replace";
  }
  const { pasted } = await api(`/api/videos/${v.id}/effects/paste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The clip they come from: pasted elsewhere, what was clicked or pinned
    // on it (an object, a moment) is chosen again.
    body: JSON.stringify({ effects: clipboard.effects, replace, from: clipboard.fromId || null }),
  });
  await refresh();
  preview();
  setStatus(`${pasted} effet${pasted > 1 ? "s" : ""} collé${pasted > 1 ? "s" : ""} sur « ${v.name} ».`);
};

// ------------------------------------------------------------- wiring

async function select(id) {
  selected = id;
  drawLibrary();
  drawStack();
  drawTimeline();
  drawCaptions(true);
  await preview();
}

async function refresh(opts = {}) {
  // Redrawing the stack replaces every input, which would drop the field
  // being edited. Remember it and put the caret back.
  const active = document.activeElement;
  const focus = active && active.dataset && active.dataset.key
    ? { fx: active.dataset.fx, key: active.dataset.key,
        at: active.selectionStart, kind: active.type }
    : null;

  [state, { assets: assetList }] = await Promise.all([
    api(`/api/state${currentProject ? `?project=${encodeURIComponent(currentProject)}` : ""}`),
    api("/api/assets"),
  ]);
  // The server answers with the tab's project, or the default if it no longer exists.
  if (state.activeProject !== currentProject) openProject(state.activeProject);
  if (selected && !videoById(selected)) selected = null;
  drawTree();
  drawPresets();
  if (!$("#view-lib").hidden) drawEffectLibrary();
  if (!$("#view-brand").hidden) drawBrandPage();
  drawCaptions(ccFor !== selected);
  drawLibrary();
  drawStack();
  drawTimeline();
  drawFormat();

  if (focus) {
    const el = document.querySelector(
      `[data-fx="${focus.fx}"][data-key="${focus.key}"]`);
    if (el) {
      el.focus();
      if (focus.at != null && el.type === focus.kind && el.setSelectionRange) {
        try { el.setSelectionRange(focus.at, focus.at); } catch { /* number inputs */ }
      }
    }
  }
  $("#head-sub").textContent =
    `${state.videos.length} vidéo(s) · ${state.effects.length} effets disponibles`;
}

async function upload(files) {
  for (const file of files) {
    setStatus(`Import de ${file.name}…`);
    try {
      const { video } = await api(`/api/videos?project=${encodeURIComponent(state.activeProject)}`, {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(file.name) },
        body: file,
      });
      await refresh();
      await select(video.id);
    } catch (error) {
      setStatus(error.message, true);
      return;
    }
  }
  setStatus("");
}

const drop = $("#drop");
drop.onclick = () => $("#file").click();
$("#file").onchange = (e) => upload([...e.target.files]);
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  upload([...e.dataTransfer.files].filter((f) => f.type.startsWith("video/")));
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

$("#play").onclick = () => {
  playing = !playing;
  post(playing ? "play" : "pause");
  $("#play").textContent = playing ? "❚❚" : "▶";
};
$("#restart").onclick = () => { playing = true; $("#play").textContent = "❚❚"; post("restart"); };
$("#refresh").onclick = () => preview();

$("#fx-add").onclick = async () => {
  const value = $("#fx-type").value || "";
  const payload = value.startsWith("preset:")
    ? { presetId: value.slice(7) }
    : { type: value.slice(5) };
  // Like Final Cut, a timed effect lands at the playhead.
  const at = currentPreviewTime();
  let { effect } = await api(`/api/videos/${selected}/effects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const vid = videoById(selected);
  const def = state.effects.find((e) => e.type === effect.type);
  if (def?.timed && vid && at > 0.05 && at < vid.duration - 0.3) {
    const len = effect.duration == null ? vid.duration - (Number(effect.start) || 0) : Number(effect.duration);
    const start = Math.round(Math.min(at, vid.duration - 0.3) * 20) / 20;
    const duration = Math.min(len, vid.duration - start);
    ({ effect } = await api(`/api/videos/${selected}/effects/${effect.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ start, duration: Math.abs(start + duration - vid.duration) < 0.02 ? null : duration }),
    }).then((r) => (r.effect ? r : { effect: { ...effect, start, duration } })));
  }
  selectedFx = effect.id;
  await refresh();

  // Land the preview where the new effect is actually on screen —
  // at frame 0 most of them have not animated in yet, which reads as
  // "nothing happened".
  const v = videoById(selected);
  preview({ at: v ? showcaseTime(v, effect) : 0 });

  const card = document.querySelector(`.fx[data-fx="${effect.id}"]`);
  if (card) {
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1200);
  }
};

// The tab title shows the render's progress, so it can be followed from
// another tab or window; the end offers to open the file or find it.
$("#render").onclick = async () => {
  $("#render").disabled = true;
  $("#prog").hidden = false;
  const title = document.title;
  const v = videoById(selected);
  const ticker = setInterval(() => {
    const p = Math.round(($("#prog").value || 0) * 100);
    document.title = `${p} % · rendu — ${title}`;
  }, 500);
  try {
    const { job } = await api(`/api/videos/${selected}/render`, { method: "POST" });
    const done = await waitJob(job.id);
    const file = done.result.output.split("/").pop();
    const open = (reveal) => api(`/api/renders/${encodeURIComponent(file)}/open`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reveal }),
    }).catch((e) => toast(e.message));
    setStatus(`Rendu terminé — <a href="${done.result.output}" download>télécharger le MP4</a>`);
    toast(`Rendu terminé : « ${v ? v.name : file} »`, {
      info: true, ms: 15000,
      actions: [{ label: "Ouvrir", run: () => open(false) }, { label: "Afficher dans le Finder", run: () => open(true) }],
    });
    document.title = `✓ Rendu terminé — ${title}`;
    setTimeout(() => { document.title = title; }, 8000);
  } catch (error) {
    setStatus(error.message, true);
    document.title = title;
  } finally {
    clearInterval(ticker);
    $("#prog").hidden = true;
    $("#render").disabled = false;
  }
};

// ------------------------------------------------ rename a clip

function renameClip(v, nameEl) {
  const input = document.createElement("input");
  input.className = "rename";
  input.value = v.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== v.name) {
      try {
        await api(`/api/videos/${v.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
        });
      } catch (error) { toast(error.message); }
    }
    await refresh();
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  };
  input.onblur = () => finish(true);
}

// ------------------------------------------------ undo / redo (⌘Z, ⇧⌘Z)
// The server keeps the steps (effects, subtitles, cut-out choice) of each
// clip; trimming and cutting reset them.

async function undoRedo(which) {
  const v = videoById(selected);
  if (!v) return;
  try {
    await flushPatches();
    const r = await api(`/api/videos/${v.id}/${which}`, { method: "POST" });
    // A notice, not the status line: the preview that follows clears it.
    if (!r.done) return toast(which === "undo" ? "Rien à annuler sur ce clip." : "Rien à rétablir.", { info: true, ms: 2500 });
    await refresh();
    drawCaptions(true);
    toast(`${which === "undo" ? "Annulé" : "Rétabli"} : ${r.label}.`, { info: true, ms: 2500 });
    preview();
  } catch (error) {
    setStatus(error.message, true);
  }
}
$("#undo").onclick = () => undoRedo("undo");
$("#redo").onclick = () => undoRedo("redo");

// Keyboard shortcuts (Final Cut style): app-fcp.js.

// ------------------------------------------------ resizable layout

// Left column, right column and timeline height, dragged by their
// splitters and remembered in this browser.
const LAYOUT_DEFAULT = { left: 280, right: 340, tl: 250 };
let layout = { ...LAYOUT_DEFAULT };
try { layout = { ...layout, ...JSON.parse(localStorage.getItem("studio.layout") || "{}") }; } catch { /* private mode */ }

function applyLayout() {
  const edit = $("#view-edit");
  const total = edit.clientWidth || innerWidth;
  // Always leave the preview column room to breathe.
  layout.left = Math.round(Math.min(Math.max(layout.left, 170), total - layout.right - 320));
  layout.right = Math.round(Math.min(Math.max(layout.right, 300), total - layout.left - 320));
  layout.tl = Math.round(Math.min(Math.max(layout.tl, 200), innerHeight * 0.65));
  // Areas hidden with the header toggles (app-fcp.js) take no room.
  const browser = !edit.classList.contains("no-browser");
  const inspector = !edit.classList.contains("no-inspector");
  edit.style.setProperty("--left", browser ? layout.left + "px" : "0px");
  edit.style.setProperty("--right", inspector ? layout.right + "px" : "0px");
  edit.style.setProperty("--tl", layout.tl + "px");
  $("#split-left").hidden = !browser;
  $("#split-right").hidden = !inspector;
  $("#split-left").style.left = layout.left + "px";
  $("#split-right").style.left = total - layout.right + "px";
  $("#tl-split").hidden = edit.classList.contains("no-timeline");
  const v = videoById(selected);
  const iframe = $("#frame iframe");
  if (v && iframe) fitFrame(iframe, v, $("#frame"));
}
const saveLayout = () => {
  try { localStorage.setItem("studio.layout", JSON.stringify(layout)); } catch { /* private mode */ }
};

function splitter(el, onMove, reset) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...layout };
    el.classList.add("dragging");
    document.body.classList.add("resizing");
    document.body.style.cursor = getComputedStyle(el).cursor;
    const move = (ev) => { onMove(ev.clientX - start.x, ev.clientY - start.y, start); applyLayout(); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.classList.remove("dragging");
      document.body.classList.remove("resizing");
      document.body.style.cursor = "";
      saveLayout();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  el.addEventListener("dblclick", () => { reset(); applyLayout(); saveLayout(); });
}
splitter($("#split-left"), (dx, dy, s) => { layout.left = s.left + dx; }, () => { layout.left = LAYOUT_DEFAULT.left; });
splitter($("#split-right"), (dx, dy, s) => { layout.right = s.right - dx; }, () => { layout.right = LAYOUT_DEFAULT.right; });
// Dragging up grows the timeline, down grows the preview.
splitter($("#tl-split"), (dx, dy, s) => { layout.tl = s.tl - dy; }, () => { layout.tl = LAYOUT_DEFAULT.tl; });
applyLayout();

window.addEventListener("resize", () => {
  applyLayout();
  const v = videoById(selected);
  const iframe = $("#frame iframe");
  if (v && iframe) fitFrame(iframe, v, $("#frame"));
  const libIframe = $("#lib-frame iframe");
  const libVideo = state.videos.find((x) => x.id === $("#lib-clip").value);
  if (libIframe && libVideo) fitFrame(libIframe, libVideo, $("#lib-frame"));
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

(async function boot() {
  if (!SERVED) {
    document.body.innerHTML = `
      <div style="max-width:560px;margin:14vh auto;padding:0 24px;text-align:center">
        <h1 style="font-size:17px;margin-bottom:10px">Ouvre le studio, pas le fichier</h1>
        <p style="color:#8b97a8;font-size:14px;line-height:1.6">
          Cette page est servie par le studio : ouverte directement depuis le
          disque (<code>file://</code>), elle ne peut joindre aucune de ses API.
        </p>
        <p style="margin-top:20px">
          <a href="http://localhost:3002"
             style="color:#4f8cff;font-size:15px">http://localhost:3002</a>
        </p>
        <p style="color:#8b97a8;font-size:13px;margin-top:18px">
          Si rien ne répond, lance d'abord <code>npm start</code>.
        </p>
      </div>`;
    return;
  }
  await refresh();
  fillEffectPicker();
  fillBasePicker();
  $("#fx-type").onchange = showEffectHint;
  if (state.videos.length) {
    const first = state.videos.find((v) => v.id === state.activeVideo) || state.videos[0];
    await select(first.id);
  }
})();
