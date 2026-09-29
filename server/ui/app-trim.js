// Mon Studio Vidéo — interface (app-trim.js).
// Trimming a clip.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ======================================================= trim

// The dialog plays the ORIGINAL footage (kept on disk after a first
// trim), so a cut can be widened again as well as narrowed.
const trimState = { video: null, total: 0, start: 0, end: 0 };
const fmtT = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
};

function drawTrim() {
  const { total, start, end } = trimState;
  const pct = (t) => (total ? (t / total) * 100 : 0) + "%";
  $("#trim-keep").style.left = pct(start);
  $("#trim-keep").style.width = total ? ((end - start) / total) * 100 + "%" : "0";
  $("#trim-in").style.left = pct(start);
  $("#trim-out").style.left = pct(end);
  if (document.activeElement !== $("#trim-start")) $("#trim-start").value = start.toFixed(2);
  if (document.activeElement !== $("#trim-end")) $("#trim-end").value = end.toFixed(2);
  const cut = total - (end - start);
  $("#trim-len").textContent = `Gardé : ${fmtT(end - start)} sur ${fmtT(total)}${cut > 0.05 ? ` · ${fmtT(cut)} coupées` : ""}`;
}

function trimTick() {
  if ($("#trim").hidden) return;
  const v = $("#trim-video");
  const t = v.currentTime || 0;
  $("#trim-head").style.left = (trimState.total ? (t / trimState.total) * 100 : 0) + "%";
  $("#trim-now").textContent = fmtT(t);
  // "Lire la sélection" stops at the end of what is kept.
  if (!v.paused && t >= trimState.end) { v.pause(); v.currentTime = trimState.end; }
  $("#trim-play").textContent = v.paused ? "▶ Lire la sélection" : "❚❚ Pause";
  requestAnimationFrame(trimTick);
}

function setTrim(start, end) {
  const min = 0.5;
  start = Math.max(0, Math.min(start, trimState.total - min));
  end = Math.min(trimState.total, Math.max(end, start + min));
  trimState.start = Math.round(start * 100) / 100;
  trimState.end = Math.round(end * 100) / 100;
  drawTrim();
}

$("#trim-open").onclick = () => {
  const v = videoById(selected);
  if (!v) return;
  if (playing) $("#play").click();
  trimState.video = v.id;
  trimState.total = v.trim ? v.trim.source : v.duration;
  const file = v.trim ? `${v.id}-orig${v.trim.ext}` : `${v.id}-bg${v.ext}`;
  const video = $("#trim-video");
  video.src = `/media/${encodeURIComponent(file)}`;
  setTrim(v.trim ? v.trim.start : 0, v.trim ? v.trim.end : v.duration);
  video.onloadedmetadata = () => { video.currentTime = trimState.start; };
  $("#trim-reset").hidden = !v.trim;
  $("#trim-msg").textContent = "L'original est conservé : tu pourras rallonger ou revenir à la vidéo entière. Les effets et les sous-titres suivent la coupe.";
  $("#trim").hidden = false;
  requestAnimationFrame(trimTick);
};

function closeTrim() {
  const video = $("#trim-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("#trim").hidden = true;
}
$("#trim-cancel").onclick = closeTrim;
$("#trim").addEventListener("keydown", (e) => { if (e.key === "Escape") closeTrim(); });

$("#trim-play").onclick = () => {
  const v = $("#trim-video");
  if (!v.paused) return v.pause();
  if (v.currentTime < trimState.start || v.currentTime >= trimState.end - 0.05) v.currentTime = trimState.start;
  v.play().catch(() => {});
};
$("#trim-set-in").onclick = () => setTrim($("#trim-video").currentTime, trimState.end);
$("#trim-set-out").onclick = () => setTrim(trimState.start, $("#trim-video").currentTime);
$("#trim-start").onchange = () => setTrim($("#trim-start").valueAsNumber || 0, trimState.end);
$("#trim-end").onchange = () => setTrim(trimState.start, $("#trim-end").valueAsNumber || trimState.total);

// The track: drag a handle to move that end, click elsewhere to seek.
(function trimTrack() {
  const track = $("#trim-track");
  const timeAt = (e) => {
    const r = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * trimState.total;
  };
  track.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const video = $("#trim-video");
    const which = e.target.id === "trim-in" ? "in" : e.target.id === "trim-out" ? "out" : null;
    const move = (ev) => {
      const t = timeAt(ev);
      if (which === "in") setTrim(t, trimState.end);
      else if (which === "out") setTrim(trimState.start, t);
      // Show the frame under the cursor while dragging.
      video.currentTime = which === "in" ? trimState.start : which === "out" ? trimState.end : t;
    };
    move(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
})();

async function applyTrim(body) {
  const videoId = trimState.video;
  const ok = $("#trim-ok");
  ok.disabled = true;
  $("#trim-reset").disabled = true;
  $("#trim-msg").textContent = "Découpe en cours…";
  try {
    const res = await api(`/api/videos/${videoId}/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.unchanged) { closeTrim(); return; }
    $("#prog").hidden = false;
    const done = await waitJob(res.job.id);
    $("#prog").hidden = true;
    closeTrim();
    await refresh();
    const r = done.result;
    const notes = [];
    if (r.clamped) notes.push(`${r.clamped} effet${r.clamped > 1 ? "s" : ""} hors de la partie gardée ramené${r.clamped > 1 ? "s" : ""} au bord`);
    if (r.dropped) notes.push(`${r.dropped} ligne${r.dropped > 1 ? "s" : ""} de sous-titres supprimée${r.dropped > 1 ? "s" : ""}`);
    if (selected === videoId) { drawTimeline(); drawCaptions(true); await preview({ at: 0 }); }
    // After the preview, which clears the status line while it prepares.
    setStatus((r.whole ? "Vidéo entière rétablie" : `Clip rogné : ${fmtT(r.duration)}`) + (notes.length ? ` — ${notes.join(", ")}.` : "."));
  } catch (error) {
    $("#prog").hidden = true;
    $("#trim-msg").textContent = error.message;
  } finally {
    ok.disabled = false;
    $("#trim-reset").disabled = false;
  }
}
$("#trim-ok").onclick = () => applyTrim({ start: trimState.start, end: trimState.end });
$("#trim-reset").onclick = () => applyTrim({ reset: true });
