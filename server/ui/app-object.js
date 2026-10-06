// Mon Studio Vidéo — interface (app-object.js).
// « Objet choisi »: click an object, SAM 2 follows it, the text goes behind it.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

const objState = {
  video: null,
  choice: "object",   // the menu entry to apply on « Suivre cet objet »
  points: [],         // clicks on the frame at `t` (x, y in 0..1; l 1/0)
  level: 2,           // size for a single click: 0 part, 1 medium, 2 whole
  t: 0,
  asking: 0,          // the latest preview request (older answers are dropped)
};

// The menu entry for a clip's cut-out options (lib/objects.mjs › cutoutChoice).
function cutoutChoiceOf(v) {
  const o = v.matteOptions || {};
  if (o.object) return o.model === "none" ? "object" : "person-object";
  return o.model === "subject" ? "subject" : "person";
}
const choiceDef = (value) => (state.options?.cutoutChoices || []).find((c) => c.value === value);

function fillCutoutMenu() {
  const sel = $("#matte-model");
  if (sel.options.length || !state.options?.cutoutChoices) return;
  for (const c of state.options.cutoutChoices) {
    const opt = document.createElement("option");
    opt.value = c.value;
    opt.textContent = c.label;
    if (c.object && !state.options.sam?.available) {
      opt.disabled = true;
      opt.textContent += " (SAM 2 non installé)";
    }
    sel.append(opt);
  }
}

// The stage keeps the frame's proportions, so clicks and the mask line up.
function sizeObjStage(v) {
  const stage = $("#obj-stage");
  const maxW = Math.min(980, innerWidth - 80);
  const maxH = innerHeight * 0.58;
  const k = Math.min(maxW / v.width, maxH / v.height);
  stage.style.width = Math.round(v.width * k) + "px";
  stage.style.height = Math.round(v.height * k) + "px";
}

function drawObjDots() {
  const dots = $("#obj-dots");
  dots.textContent = "";
  for (const p of objState.points) {
    const d = document.createElement("span");
    d.className = "obj-dot" + (p.l ? "" : " minus");
    d.style.left = p.x * 100 + "%";
    d.style.top = p.y * 100 + "%";
    d.textContent = p.l ? "+" : "−";
    dots.append(d);
  }
  $("#obj-ok").disabled = !objState.points.some((p) => p.l);
  // The size only means something for a single click; more clicks refine.
  const single = objState.points.length === 1;
  for (const b of document.querySelectorAll("#obj-level button")) {
    b.classList.toggle("on", Number(b.dataset.level) === objState.level);
    b.disabled = !single;
  }
}

for (const b of document.querySelectorAll("#obj-level button")) {
  b.onclick = () => {
    objState.level = Number(b.dataset.level);
    drawObjDots();
    askObjMask();
  };
}

async function askObjMask() {
  const ask = ++objState.asking;
  if (!objState.points.some((p) => p.l)) {
    $("#obj-mask").hidden = true;
    return;
  }
  $("#obj-msg").textContent = objState.asking === 1 && !objState.warm
    ? "Chargement de SAM 2 (une dizaine de secondes la première fois)…"
    : "Calcul du contour…";
  try {
    const r = await api(`/api/videos/${objState.video}/object/preview`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: objState.t, points: objState.points, level: objState.level }),
    });
    if (ask !== objState.asking) return;
    objState.warm = true;
    $("#obj-mask").src = r.overlay;
    $("#obj-mask").hidden = false;
    $("#obj-msg").textContent = r.area < 0.002
      ? "Rien de détecté ici : clique au milieu de l'objet."
      : `Objet : ${Math.round(r.area * 100)} % de l'image. Pas la bonne taille ? Essaie Partie · Moyen · Entier. Un autre clic ajoute une partie oubliée, ⌥-clic retire ce qui déborde. Puis « Suivre cet objet ».`;
  } catch (error) {
    if (ask === objState.asking) $("#obj-msg").textContent = error.message;
  }
}

// `target` (optional): an effect's « Sujet » object instead of the clip's
// cut-out — { existing, save(object) }.
function openObject(v, choice, target = null) {
  objState.video = v.id;
  objState.choice = choice;
  objState.target = target;
  const existing = target ? target.existing : v.matteOptions?.object;
  objState.points = existing ? existing.points.map((p) => ({ ...p })) : [];
  objState.level = existing?.level ?? 2;
  objState.t = existing ? existing.t : Math.min(currentPreviewTime() || 0, v.duration - 0.05);
  const range = $("#obj-time");
  range.max = String(Math.max(0, v.duration - 0.05));
  range.value = String(objState.t);
  $("#obj-now").textContent = fmtT(objState.t);
  $("#obj-mask").hidden = true;
  sizeObjStage(v);
  // A still frame from the server, not a <video>: a video under an
  // overlay can show black in Chrome.
  showObjFrame();
  drawObjDots();
  $("#obj-msg").textContent = "Choisis une image où l'objet se voit bien, puis clique dessus : il se colore en bleu. ⌥-clic (ou clic droit) sur ce qui déborde pour le retirer.";
  $("#obj").hidden = false;
  if (objState.points.length) askObjMask();
}

let objFrameTimer = null;
function showObjFrame() {
  const v = videoById(objState.video);
  if (!v) return;
  const w = Math.min(1280, Math.round(parseFloat($("#obj-stage").style.width) * devicePixelRatio) || 960);
  $("#obj-frame").src = `/api/videos/${v.id}/frame?t=${objState.t.toFixed(2)}&w=${w}`;
}

$("#obj-time").oninput = () => {
  const t = Number($("#obj-time").value) || 0;
  objState.t = t;
  clearTimeout(objFrameTimer);
  objFrameTimer = setTimeout(showObjFrame, 90);
  $("#obj-now").textContent = fmtT(t);
  // Clicks belong to one frame.
  if (objState.points.length) {
    objState.points = [];
    objState.asking++;
    $("#obj-mask").hidden = true;
    drawObjDots();
  }
};

function objClick(e, l) {
  e.preventDefault();
  const r = $("#obj-stage").getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  objState.points.push({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, l });
  drawObjDots();
  askObjMask();
}
$("#obj-stage").addEventListener("click", (e) => objClick(e, e.altKey ? 0 : 1));
$("#obj-stage").addEventListener("contextmenu", (e) => objClick(e, 0));

$("#obj-clear").onclick = () => {
  objState.points = [];
  objState.asking++;
  $("#obj-mask").hidden = true;
  drawObjDots();
};

function closeObject() {
  $("#obj-frame").removeAttribute("src");
  $("#obj").hidden = true;
  drawClipbar();
}
$("#obj-cancel").onclick = closeObject;
$("#obj").addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeObject();
  e.stopPropagation();
});

$("#obj-ok").onclick = async () => {
  const id = objState.video;
  const object = { t: objState.t, points: objState.points, level: objState.level };
  if (objState.target) {
    // An effect's subject: saved on the effect, followed at the next preview.
    const { save } = objState.target;
    closeObject();
    setStatus("Suivi de l'objet dans tout le clip à l'aperçu… (environ 4 images par seconde)");
    return save(object);
  }
  try {
    await api(`/api/videos/${id}/matte`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice: objState.choice, object: { t: objState.t, points: objState.points, level: objState.level } }),
    });
    closeObject();
    await refresh();
    if (selected === id) {
      setStatus("Suivi de l'objet dans tout le clip… (environ 4 images par seconde)");
      await preview();
    }
  } catch (error) {
    $("#obj-msg").textContent = error.message;
  }
};

$("#matte-obj").onclick = () => {
  const v = videoById(selected);
  if (v) openObject(v, choiceDef(cutoutChoiceOf(v))?.object ? cutoutChoiceOf(v) : "person-object");
};
