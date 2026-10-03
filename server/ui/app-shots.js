// Mon Studio Vidéo — interface (app-shots.js).
// Splitting a long rush into shots (PySceneDetect).
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

const shotsState = {
  video: null,
  shots: [],    // [{ start, end, keep }]
  playEnd: null,
  busy: false,
};

function drawShots() {
  const grid = $("#sh-grid");
  grid.textContent = "";
  const { shots } = shotsState;
  if (!shots.length) {
    grid.innerHTML = '<p class="tx-empty">Choisis la sensibilité puis « Détecter les plans ». Chaque plan trouvé pourra devenir un clip.</p>';
  }
  shots.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "sh-card" + (s.keep ? "" : " off");
    const mid = (s.start + s.end) / 2;
    card.innerHTML = `
      <button class="sh-thumb" title="Voir ce plan"><img loading="lazy" alt=""
        src="/api/videos/${shotsState.video}/frame?t=${mid.toFixed(2)}"></button>
      <label class="sh-meta"><input type="checkbox" ${s.keep ? "checked" : ""}>
        <b>Plan ${i + 1}</b><span>${fmtT(s.start)} → ${fmtT(s.end)} · ${fmtS(s.end - s.start)}</span></label>
      ${i < shots.length - 1 ? '<button class="sh-merge" title="Réunir ce plan et le suivant (coupe en trop)">⊕ avec le suivant</button>' : ""}`;
    card.querySelector(".sh-thumb").onclick = () => playShot(i);
    card.querySelector("input").onchange = (e) => { s.keep = e.target.checked; card.classList.toggle("off", !s.keep); drawShotsSummary(); };
    const merge = card.querySelector(".sh-merge");
    if (merge) merge.onclick = () => {
      const next = shots[i + 1];
      shots.splice(i, 2, { start: s.start, end: next.end, keep: s.keep || next.keep });
      drawShots();
    };
    grid.append(card);
  });
  drawShotsSummary();
}

function drawShotsSummary() {
  const kept = shotsState.shots.filter((s) => s.keep);
  const total = kept.reduce((n, s) => n + s.end - s.start, 0);
  $("#sh-len").textContent = shotsState.shots.length
    ? `${shotsState.shots.length} plans trouvés · ${kept.length} gardé${kept.length > 1 ? "s" : ""} (${fmtT(total)})`
    : "";
  $("#sh-ok").textContent = kept.length > 1 ? `Créer ${kept.length} clips` : "Créer le clip";
  $("#sh-ok").disabled = shotsState.busy || !kept.length;
  $("#sh-all").hidden = !shotsState.shots.length;
}

function playShot(i) {
  const s = shotsState.shots[i];
  const v = $("#sh-video");
  v.currentTime = s.start;
  shotsState.playEnd = s.end;
  v.play().catch(() => {});
  for (const [k, card] of [...$("#sh-grid").children].entries()) card.classList.toggle("now", k === i);
}
$("#sh-video").addEventListener("timeupdate", () => {
  const v = $("#sh-video");
  if (shotsState.playEnd != null && v.currentTime >= shotsState.playEnd) { v.pause(); shotsState.playEnd = null; }
});

$("#sh-open").onclick = () => {
  const v = videoById(selected);
  if (!v) return;
  if (playing) $("#play").click();
  shotsState.video = v.id;
  shotsState.shots = [];
  const sel = $("#sh-sens");
  if (!sel.options.length) {
    for (const o of state.options.sensitivities || []) {
      const opt = document.createElement("option");
      opt.value = o.value; opt.textContent = o.label;
      sel.append(opt);
    }
    sel.value = "normal";
  }
  const available = Boolean(state.options?.scenes?.available);
  $("#sh-detect").disabled = !available;
  $("#sh-msg").textContent = available
    ? `« ${v.name} » (${fmtT(v.duration)}). La détection repère chaque changement de plan ; le rush reste tel quel, les plans choisis deviennent des clips à côté.`
    : "PySceneDetect n'est pas installé sur ce Mac (voir le README, « Découper un rush en plans »).";
  $("#sh-video").src = `/media/${encodeURIComponent(`${v.id}-bg${v.ext}`)}`;
  drawShots();
  $("#shots").hidden = false;
};

$("#sh-detect").onclick = async () => {
  const button = $("#sh-detect");
  button.disabled = true;
  shotsState.busy = true;
  drawShotsSummary();
  $("#sh-msg").textContent = "Recherche des plans…";
  $("#prog").hidden = false;
  try {
    const { job } = await api(`/api/videos/${shotsState.video}/shots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sensitivity: $("#sh-sens").value, minShot: Number($("#sh-min").value) || 1 }),
    });
    const done = await waitJob(job.id);
    setStatus("");
    shotsState.shots = done.result.scenes.map((s) => ({ ...s, keep: true }));
    $("#sh-msg").textContent = shotsState.shots.length > 1
      ? "Clic sur une image : voir le plan. Décoche ceux à laisser de côté ; « ⊕ avec le suivant » réunit deux plans coupés en trop."
      : "Un seul plan trouvé : ce clip ne change pas de plan. Essaie la sensibilité « Fine » si tu en attendais plusieurs.";
  } catch (error) {
    $("#sh-msg").textContent = error.message;
  } finally {
    $("#prog").hidden = true;
    shotsState.busy = false;
    button.disabled = false;
    drawShots();
  }
};

$("#sh-all").onclick = () => {
  const all = shotsState.shots.every((s) => s.keep);
  for (const s of shotsState.shots) s.keep = !all;
  drawShots();
};

function closeShots() {
  const v = $("#sh-video");
  v.pause();
  v.removeAttribute("src");
  v.load();
  $("#shots").hidden = true;
}
$("#sh-cancel").onclick = closeShots;
$("#shots").addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeShots();
  e.stopPropagation();
});

$("#sh-ok").onclick = async () => {
  const videoId = shotsState.video;
  const picked = shotsState.shots.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.keep);
  if (!picked.length) return;
  shotsState.busy = true;
  drawShotsSummary();
  $("#sh-msg").textContent = "Création des clips…";
  $("#prog").hidden = false;
  try {
    const { job } = await api(`/api/videos/${videoId}/split`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shots: picked.map(({ start, end }) => ({ start, end })), numbers: picked.map((s) => s.n) }),
    });
    const done = await waitJob(job.id);
    $("#prog").hidden = true;
    closeShots();
    await refresh();
    const n = done.result.created.length;
    const rush = videoById(videoId);
    setStatus(`${n} clip${n > 1 ? "s" : ""} créé${n > 1 ? "s" : ""} à partir de « ${rush ? rush.name : "ce rush"} », juste après lui.`);
  } catch (error) {
    $("#prog").hidden = true;
    $("#sh-msg").textContent = error.message;
  } finally {
    shotsState.busy = false;
    drawShotsSummary();
  }
};
