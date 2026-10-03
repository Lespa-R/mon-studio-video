// Mon Studio Vidéo — interface (app-textcut.js).
// Montage par le texte: cut the clip by removing words and pauses.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.
//
// The maths (tokens, removed ranges, time maps) is lib/textcut.mjs, which
// the server also uses; index.html loads it as a module into window.TextCut.
// Like the trim dialog, this one plays the ORIGINAL footage: a passage
// removed earlier can be put back.

const tx = {
  video: null,     // clip id
  transcript: null,
  range: { start: 0, end: 0 },  // the trim, kept as is
  cuts: [],        // removed passages, original time
  initial: "[]",   // to tell whether anything changed
  tokens: [],
  busy: false,
};

const fmtS = (n) => `${n.toFixed(1).replace(".", ",")} s`;

function txKept() {
  const T = window.TextCut;
  return T.keptLength(T.keptSegments({ ...tx.range, cuts: tx.cuts }));
}

// Whether a token shows as removed. A pause or hesitation counts as removed
// when most of what can go is gone.
function txTokenCut(t) {
  const T = window.TextCut;
  // A word is judged on its own sound, not on the half-gaps around it that
  // removing it would also take.
  if (t.kind === "word") return T.isCut(tx.cuts, t.s, t.e);
  let n = 0;
  for (const c of tx.cuts) n += Math.max(0, Math.min(t.end, c.end) - Math.max(t.start, c.start));
  return n >= Math.min(0.1, Math.max(0.04, (t.length - 0.25) * 0.5));
}
const txOutside = (t) => t.end <= tx.range.start + 0.02 || t.start >= tx.range.end - 0.02;

function drawTx() {
  const box = $("#tx-text");
  box.textContent = "";
  if (!tx.transcript) {
    box.innerHTML = '<p class="tx-empty">Ce clip n\'a pas encore de transcription. Choisis la langue et lance « Transcrire avec Whisper » : tout se fait sur ce Mac.</p>';
    return;
  }
  if (!tx.tokens.length) {
    box.innerHTML = '<p class="tx-empty">Aucune parole reconnue dans ce clip.</p>';
    return;
  }
  tx.tokens.forEach((t, k) => {
    const el = document.createElement("span");
    el.dataset.k = k;
    if (t.kind === "word") {
      el.className = "tw" + (t.filler ? " filler" : "");
      el.textContent = t.w;
      el.title = `${fmtT(t.s)} — clic : écouter`;
    } else {
      el.className = t.kind === "pause" ? "tp" : "th";
      el.textContent = t.kind === "pause" ? `⏸ ${fmtS(t.length)}` : `≈ ${fmtS(t.length)}`;
      el.title = t.kind === "pause"
        ? "Silence. Clic : le raccourcir / le remettre."
        : "On entend quelque chose mais aucun mot n'est écrit : souvent un « euh », une hésitation ou un faux départ — parfois un vrai mot que Whisper n'a pas compris. Écoute avant de couper. Clic : couper / remettre.";
    }
    if (txOutside(t)) el.classList.add("out");
    else if (txTokenCut(t)) el.classList.add("cut");
    box.append(el, document.createTextNode(" "));
  });
  drawTxSummary();
}

function drawTxSummary() {
  const total = tx.range.end - tx.range.start;
  const kept = txKept();
  const n = tx.cuts.length;
  $("#tx-len").textContent = n
    ? `Durée : ${fmtT(total)} → ${fmtT(kept)} (−${fmtS(total - kept)}, ${n} passage${n > 1 ? "s" : ""} retiré${n > 1 ? "s" : ""})`
    : `Durée : ${fmtT(total)}`;
  $("#tx-ok").disabled = tx.busy || JSON.stringify(tx.cuts) === tx.initial;
}

function setTxCuts(cuts) {
  const T = window.TextCut;
  tx.cuts = T.normaliseCuts(cuts, tx.range.start, tx.range.end);
  for (const el of $("#tx-text").querySelectorAll("[data-k]")) {
    const t = tx.tokens[el.dataset.k];
    if (!txOutside(t)) el.classList.toggle("cut", txTokenCut(t));
  }
  drawTxSummary();
}

// The tokens under the text selection (inside the trimmed range).
function txSelected() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !$("#tx-text").contains(sel.anchorNode)) return [];
  return [...$("#tx-text").querySelectorAll("[data-k]")]
    .filter((el) => sel.containsNode(el, true))
    .map((el) => tx.tokens[el.dataset.k])
    .filter((t) => !txOutside(t));
}

// Remove the selection — or put it back if it is all removed already.
function txToggleSelection() {
  const T = window.TextCut;
  const picked = txSelected();
  if (!picked.length) return false;
  const a = picked[0].start;
  const b = picked[picked.length - 1].end;
  const allCut = picked.every(txTokenCut);
  setTxCuts(allCut ? T.restore(tx.cuts, a, b) : [...tx.cuts, { start: a, end: b }]);
  window.getSelection().removeAllRanges();
  return true;
}

function txToggleGap(t) {
  const T = window.TextCut;
  if (txTokenCut(t)) return setTxCuts(T.restore(tx.cuts, t.start, t.end));
  const c = T.gapCut(t, 0.25);
  if (c) setTxCuts([...tx.cuts, c]);
}

// Playback skips what is removed, so you hear the edit before applying it.
function txTick() {
  if ($("#tx").hidden) return;
  const v = $("#tx-video");
  let t = v.currentTime || 0;
  if (!v.paused) {
    const T = window.TextCut;
    const segs = T.keptSegments({ ...tx.range, cuts: tx.cuts });
    const inside = segs.find((s) => t >= s.start - 0.01 && t < s.end - 0.02);
    if (!inside) {
      const next = segs.find((s) => s.start > t);
      if (next) { v.currentTime = next.start; t = next.start; } else v.pause();
    }
  }
  $("#tx-now").textContent = fmtT(t);
  $("#tx-play").textContent = v.paused ? "▶ Écouter le montage" : "❚❚ Pause";
  // Follow the word being said.
  const box = $("#tx-text");
  const prev = box.querySelector(".now");
  const k = tx.tokens.findIndex((tk) => tk.kind === "word" && t >= tk.s && t < tk.e + 0.05);
  const el = k >= 0 ? box.querySelector(`[data-k="${k}"]`) : null;
  if (prev !== el) {
    if (prev) prev.classList.remove("now");
    if (el) {
      el.classList.add("now");
      if (!v.paused) el.scrollIntoView({ block: "nearest" });
    }
  }
  requestAnimationFrame(txTick);
}

function txSetTranscript(transcript) {
  tx.transcript = transcript;
  tx.tokens = transcript ? window.TextCut.tokens(transcript) : [];
  $("#tx-tools").hidden = !transcript;
  drawTx();
}

$("#tx-open").onclick = async () => {
  const v = videoById(selected);
  if (!v) return;
  if (!window.TextCut) return setStatus("Le module de montage texte n'est pas chargé : recharge la page.", true);
  if (!v.hasAudio) return setStatus("Ce clip n'a pas de son : rien à monter par le texte.", true);
  if (playing) $("#play").click();
  let info;
  try {
    info = await api(`/api/videos/${v.id}/transcript`);
  } catch (error) {
    return setStatus(error.message, true);
  }
  tx.video = v.id;
  tx.range = { start: info.cut.start, end: info.cut.end };
  tx.cuts = info.cut.cuts || [];
  tx.initial = JSON.stringify(window.TextCut.normaliseCuts(tx.cuts, tx.range.start, tx.range.end));
  const video = $("#tx-video");
  video.src = info.source.url;
  video.onloadedmetadata = () => { video.currentTime = tx.range.start; };
  const langSel = $("#tx-lang");
  if (!langSel.options.length) {
    for (const l of state.options.languages) {
      const opt = document.createElement("option");
      opt.value = l.value; opt.textContent = l.label;
      langSel.append(opt);
    }
  }
  langSel.value = info.transcript?.lang || v.captions?.lang || "fr-FR";
  $("#tx-transcribe").disabled = !info.whisper.available;
  $("#tx-msg").textContent = info.whisper.available
    ? "Sélectionne des mots puis ⌫ pour les retirer (⌫ sur une sélection déjà retirée la remet). Clic sur un mot : l'écouter. L'original est conservé."
    : "Whisper n'est pas installé sur ce Mac (brew install whisper-cpp, et le modèle dans models/).";
  txSetTranscript(info.transcript);
  $("#tx").hidden = false;
  requestAnimationFrame(txTick);
};

$("#tx-transcribe").onclick = async () => {
  const button = $("#tx-transcribe");
  button.disabled = true;
  $("#tx-msg").textContent = "Transcription Whisper sur ce Mac… (quelques secondes par minute de vidéo)";
  $("#prog").hidden = false;
  try {
    const { job } = await api(`/api/videos/${tx.video}/transcript`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: $("#tx-lang").value, force: true }),
    });
    await waitJob(job.id);
    setStatus("");
    const info = await api(`/api/videos/${tx.video}/transcript`);
    txSetTranscript(info.transcript);
    const words = info.transcript?.words.length || 0;
    $("#tx-msg").textContent = words
      ? `${words} mots. Les ⏸ sont des silences, les ≈ du son sans texte (hésitations). Sélectionne puis ⌫ pour retirer.`
      : "Aucune parole reconnue dans ce clip.";
  } catch (error) {
    $("#tx-msg").textContent = error.message;
  } finally {
    $("#prog").hidden = true;
    button.disabled = false;
  }
};

$("#tx-text").addEventListener("click", (e) => {
  const el = e.target.closest("[data-k]");
  if (!el || !window.getSelection().isCollapsed) return;
  const t = tx.tokens[el.dataset.k];
  if (txOutside(t)) return;
  if (t.kind === "word") {
    const v = $("#tx-video");
    v.currentTime = t.s;
    v.play().catch(() => {});
    // Hear just this word and a little after.
    const stopAt = t.e + 0.25;
    const stop = () => { if (v.currentTime >= stopAt) { v.pause(); v.removeEventListener("timeupdate", stop); } };
    v.addEventListener("timeupdate", stop);
  } else {
    txToggleGap(t);
  }
});

$("#tx-cut").onclick = () => {
  if (!txToggleSelection()) $("#tx-msg").textContent = "Sélectionne d'abord des mots dans le texte (glisser avec la souris).";
};

$("#tx-auto").onclick = () => {
  const T = window.TextCut;
  const maxPause = Math.max(0.2, Number($("#tx-maxpause").value) || 0.6);
  const add = T.autoCuts(tx.transcript, { maxPause, keep: 0.25, hesitations: $("#tx-hes").checked });
  const before = txKept();
  setTxCuts([...tx.cuts, ...add]);
  const gained = before - txKept();
  $("#tx-msg").textContent = gained > 0.05
    ? `Nettoyage : ${fmtS(gained)} en moins. Écoute le résultat, clique sur un ⏸ ou un ≈ pour le remettre.`
    : "Rien à nettoyer avec ces réglages.";
};

$("#tx-clear").onclick = () => setTxCuts([]);

$("#tx-play").onclick = () => {
  const v = $("#tx-video");
  if (!v.paused) return v.pause();
  if (v.currentTime < tx.range.start || v.currentTime >= tx.range.end - 0.05) v.currentTime = tx.range.start;
  v.play().catch(() => {});
};

function closeTx() {
  const video = $("#tx-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("#tx").hidden = true;
}
$("#tx-cancel").onclick = closeTx;
$("#tx").addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeTx();
  if ((e.key === "Backspace" || e.key === "Delete") && e.target.tagName !== "INPUT") {
    if (txToggleSelection()) e.preventDefault();
  }
  // The montage's shortcuts (space, J/K/L…) must not fire behind the dialog.
  e.stopPropagation();
});

$("#tx-ok").onclick = async () => {
  const videoId = tx.video;
  tx.busy = true;
  drawTxSummary();
  $("#tx-msg").textContent = "Montage de la vidéo…";
  try {
    const res = await api(`/api/videos/${videoId}/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cuts: tx.cuts }),
    });
    if (res.unchanged) { closeTx(); return; }
    $("#prog").hidden = false;
    const done = await waitJob(res.job.id);
    $("#prog").hidden = true;
    closeTx();
    await refresh();
    const r = done.result;
    const notes = [];
    if (r.clamped) notes.push(`${r.clamped} effet${r.clamped > 1 ? "s" : ""} déplacé${r.clamped > 1 ? "s" : ""} au bord d'un passage retiré`);
    if (r.dropped) notes.push(`${r.dropped} ligne${r.dropped > 1 ? "s" : ""} de sous-titres retirée${r.dropped > 1 ? "s" : ""}`);
    if (selected === videoId) { drawTimeline(); drawCaptions(true); await preview({ at: 0 }); }
    setStatus((r.cuts ? `Montage appliqué : ${fmtT(r.duration)}` : "Passages remis : " + fmtT(r.duration)) +
      (notes.length ? ` — ${notes.join(", ")}.` : "."));
  } catch (error) {
    $("#prog").hidden = true;
    $("#tx-msg").textContent = error.message;
  } finally {
    tx.busy = false;
    drawTxSummary();
  }
};
