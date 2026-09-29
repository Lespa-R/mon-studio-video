// Mon Studio HyperFrame — interface (app-promos.js).
// Promos tab (Remotion, skill promo-site).
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ===================================================== promos (Remotion)
// A promo is a storyboard of scenes rendered by the skill promo-site's
// Remotion engine (~/Code/promos). Claude writes the storyboard from the
// site; here Robin retouches it, picks a brand kit, checks and renders.

let promoData = null;      // { promos, catalogue, workspace, hasSkill, hasWorkspace }
let promoSel = null;       // slug
let promo = null;          // detail of the selected promo
let promoSb = null;        // working copy of its storyboard
let promoDirty = false;
let promoBusy = false;
let prScene = null;        // last scene preview { index, video, sheet, report }
let prDraft = null;        // { slug, text } LinkedIn post draft from the storyboard

const prCat = () => promoData.catalogue;
const prType = (t) => prCat().scenes.find((x) => x.type === t);
const prGet = (o, k) => k.split(".").reduce((a, x) => (a == null ? undefined : a[x]), o);
const prSet = (o, k, v) => {
  const parts = k.split(".");
  let cur = o;
  for (const x of parts.slice(0, -1)) { if (typeof cur[x] !== "object" || !cur[x]) cur[x] = {}; cur = cur[x]; }
  const last = parts[parts.length - 1];
  if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete cur[last]; else cur[last] = v;
};
// Same line format as lib/promos.mjs (toText / fromText).
const prToText = (f, v) => {
  if (v == null) return "";
  if (f.kind === "lines") return (Array.isArray(v) ? v : [v]).join("\n");
  if (f.kind === "tuples") return v.map((r) => (Array.isArray(r) ? r : [r]).join(" | ")).join("\n");
  if (f.kind === "rows") return v.map((r) => (typeof r === "string" ? r : f.cols.map((c) => r?.[c] ?? "").join(" | "))).join("\n");
  return String(v);
};
const prFromText = (f, text) => {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const cells = (l) => l.split("|").map((c) => c.trim());
  if (f.kind === "lines") return lines;
  if (f.kind === "tuples") return lines.map((l) => { const c = cells(l).slice(0, f.cols); while (c.length < f.cols) c.push(""); return c; });
  if (f.kind === "rows") return lines.map((l) => {
    const c = cells(l); const row = {};
    f.cols.forEach((k, i) => { const v = i === f.cols.length - 1 ? c.slice(i).join(" | ") : c[i]; if (v) row[k] = v; });
    return row;
  });
  return String(text).trim();
};
const fmtSec = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

async function drawPromos() {
  try {
    promoData = await api("/api/promos");
  } catch (error) {
    // index.html is re-read on every load, server code only at start: a
    // studio launched before this tab existed does not know the route.
    const stale = /unknown route|not found/i.test(error.message);
    $("#promo-editor").innerHTML = `<div class="pr-empty">${stale
      ? "Le serveur du studio date d'avant l'onglet Promos.<br><b>Relance le studio</b> : double-clic sur « Mon Studio HyperFrame » sur le Bureau."
      : escapeHtml(error.message)}</div>`;
    return;
  }
  if (promoSel && !promoData.promos.some((p) => p.slug === promoSel)) promoSel = null;
  if (!promoSel && promoData.promos[0]) promoSel = promoData.promos[0].slug;
  drawPromoList();
  if (promoSel && (!promo || promo.slug !== promoSel)) await openPromo(promoSel);
  else { drawPromoEditor(); drawPromoSide(); }
}

function drawPromoList() {
  const el = $("#promo-list");
  el.innerHTML = "";
  if (!promoData.hasSkill) {
    el.innerHTML = `<div class="pr-empty">Skill <b>promo-site</b> introuvable.<br>Attendue dans <code>${escapeHtml(promoData.skill)}</code>.</div>`;
  }
  for (const p of promoData.promos) {
    const row = document.createElement("div");
    row.className = "tree-row pr-item" + (p.slug === promoSel ? " on" : "");
    row.innerHTML = `<span class="grow">${escapeHtml(p.title)}<br><span class="meta">${p.error ? "storyboard illisible" : `${p.scenes} scènes · ${fmtSec(p.duration)} · ${escapeHtml(p.formats.join(", "))}`}${p.lastRender ? " · rendue" : ""}</span></span>`;
    const del = document.createElement("button");
    del.className = "x";
    del.textContent = "✕";
    del.title = "Mettre la promo à la corbeille";
    del.onclick = async (e) => {
      e.stopPropagation();
      if (promoBusy && p.slug === promoSel) return toast("Attends la fin du traitement en cours.");
      if (!(await askConfirm("Supprimer la promo",
        `« ${p.title} » part à la Corbeille du Mac : storyboard, captures, musique et vidéos rendues. Tu pourras la récupérer depuis la Corbeille.`,
        "Mettre à la corbeille"))) return;
      try {
        await api(`/api/promos/${p.slug}`, { method: "DELETE" });
        if (p.slug === promoSel) { promoSel = null; promo = null; promoSb = null; promoDirty = false; }
        toast(`« ${p.title} » est dans la corbeille.`);
        await drawPromos();
      } catch (error) { toast(error.message); }
    };
    row.appendChild(del);
    row.onclick = async () => {
      if (p.slug === promoSel) return;
      if (promoDirty && !(await askConfirm("Modifications non enregistrées", "Quitter cette promo sans enregistrer ?", "Quitter"))) return;
      await openPromo(p.slug);
      drawPromoList();
    };
    el.appendChild(row);
  }
  if (!promoData.promos.length && promoData.hasSkill) {
    el.innerHTML = `<div class="pr-empty">Aucune promo.<br>Demande à Claude « fais une promo pour https://… » ou crée-en une ici.</div>`;
  }
  $("#promo-where").innerHTML = `Dossier : <code>${escapeHtml(promoData.workspace)}</code>`;
}

async function openPromo(slug) {
  promoSel = slug;
  promo = await api(`/api/promos/${slug}`);
  promoSb = JSON.parse(JSON.stringify(promo.storyboard));
  promoDirty = false;
  drawPromoEditor();
  drawPromoSide();
}

function markPromoDirty() {
  promoDirty = true;
  const b = $("#pr-save");
  if (b) { b.disabled = false; b.textContent = "Enregistrer *"; }
}

function prField(label, input, wide) {
  const w = document.createElement("label");
  w.className = "pr-field";
  if (wide) w.style.gridColumn = "1 / -1";
  w.append(label);
  w.appendChild(input);
  return w;
}

function prInput(value, onInput, { type = "text", placeholder = "", area = false } = {}) {
  const el = document.createElement(area ? "textarea" : "input");
  if (!area) el.type = type;
  el.value = value ?? "";
  el.placeholder = placeholder;
  el.oninput = () => { onInput(el.value); markPromoDirty(); };
  return el;
}

function prSelect(options, value, onChange) {
  const el = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    el.appendChild(opt);
  }
  el.onchange = () => onChange(el.value);
  return el;
}

function drawPromoEditor() {
  const el = $("#promo-editor");
  el.innerHTML = "";
  if (!promoSb) {
    $("#promo-title").textContent = "Storyboard";
    if (promoData?.promos.length) el.innerHTML = `<div class="pr-empty">Choisis une promo.</div>`;
    return;
  }
  $("#promo-title").textContent = `Storyboard · ${promoSb.title || promo.slug}`;
  const wrap = document.createElement("div");
  wrap.className = "pr-editor";

  // ---- general
  const gen = document.createElement("div");
  gen.className = "pr-box";
  gen.innerHTML = `<h3>Général</h3>`;
  const grid = document.createElement("div");
  grid.className = "pr-grid";
  grid.appendChild(prField("Titre", prInput(promoSb.title, (v) => { promoSb.title = v; })));
  grid.appendChild(prField("Adresse du site", prInput(promoSb.url, (v) => { promoSb.url = v; }, { placeholder: "https://…" })));
  const moodSel = prSelect(prCat().moods, promoSb.music.mood, (v) => {
    promoSb.music.mood = v;
    const m = prCat().moods.find((x) => x.value === v);
    if (m) { promoSb.music.bpm = m.bpm; bpm.value = m.bpm; }
    markPromoDirty(); drawPromoSide();
  });
  moodSel.disabled = promoSb.music.mode === "file";
  grid.appendChild(prField(promoSb.music.mode === "file" ? "Musique (fichier fourni)" : "Ambiance musicale", moodSel));
  const bpm = prInput(promoSb.music.bpm, (v) => { promoSb.music.bpm = Number(v) || 120; drawPromoSide(); }, { type: "number" });
  bpm.min = 60; bpm.max = 180;
  grid.appendChild(prField("Tempo (BPM) — 1 mesure = 240 ÷ BPM s", bpm));
  const fm = document.createElement("div");
  fm.className = "pr-formats";
  for (const f of prCat().formats) {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = promoSb.formats.includes(f.value);
    c.onchange = () => {
      promoSb.formats = prCat().formats.map((x) => x.value).filter((v) => (v === f.value ? c.checked : promoSb.formats.includes(v)));
      if (!promoSb.formats.length) { promoSb.formats = ["4:5"]; drawPromoEditor(); }
      markPromoDirty();
    };
    l.append(c, f.label);
    fm.appendChild(l);
  }
  grid.appendChild(prField("Formats rendus", fm, true));
  grid.appendChild(prField("Éléments inventés à signaler (un par ligne)",
    prInput(promoSb.invented.join("\n"), (v) => { promoSb.invented = v.split("\n").map((x) => x.trim()).filter(Boolean); }, { area: true }), true));
  gen.appendChild(grid);
  const tip = document.createElement("div");
  tip.className = "pr-help";
  tip.innerHTML = `Dans les textes : <code>**mot**</code> couleur d'accent · <code>*mot*</code> italique · <code>|</code> retour à la ligne. Colonnes séparées par <code>|</code>.`;
  gen.appendChild(tip);
  wrap.appendChild(gen);

  // ---- scenes
  const timing = prTiming();
  promoSb.scenes.forEach((sc, i) => {
    const def = prType(sc.type);
    const box = document.createElement("div");
    box.className = "pr-box pr-scene";
    box.dataset.energy = sc.energy;
    const head = document.createElement("div");
    head.className = "pr-scene-head";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = i + 1;
    const type = prSelect(prCat().scenes.map((t) => ({ value: t.type, label: t.label })), sc.type, (v) => {
      sc.type = v; markPromoDirty(); drawPromoEditor(); drawPromoSide();
    });
    type.title = "Type de scène";
    const bars = prInput(sc.bars, (v) => { sc.bars = Math.max(1, Math.min(8, Math.round(Number(v) || 1))); drawPromoSide(); }, { type: "number" });
    bars.min = 1; bars.max = 8; bars.title = "Durée en mesures";
    const energy = prSelect(prCat().energies, sc.energy, (v) => { sc.energy = v; box.dataset.energy = v; markPromoDirty(); drawPromoSide(); });
    energy.title = "Énergie : pilote la musique (kick, pause, montée) et les flashes";
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= promoSb.scenes.length) return;
      [promoSb.scenes[i], promoSb.scenes[j]] = [promoSb.scenes[j], promoSb.scenes[i]];
      markPromoDirty(); drawPromoEditor(); drawPromoSide();
    };
    const up = document.createElement("button"); up.textContent = "↑"; up.title = "Monter"; up.onclick = () => move(-1);
    const down = document.createElement("button"); down.textContent = "↓"; down.title = "Descendre"; down.onclick = () => move(1);
    const del = document.createElement("button"); del.textContent = "✕"; del.title = "Supprimer la scène";
    del.onclick = async () => {
      if (!(await askConfirm("Supprimer la scène", `Supprimer la scène ${i + 1} (${def?.label || sc.type}) ?`))) return;
      promoSb.scenes.splice(i, 1); markPromoDirty(); drawPromoEditor(); drawPromoSide();
    };
    const play = document.createElement("button"); play.textContent = "▶"; play.title = "Aperçu de cette scène seule (quelques secondes, mi-résolution) + contrôle des textes";
    play.onclick = async () => {
      const r = await promoAction("scene", `Aperçu de la scène ${i + 1}`, { index: i });
      if (r) { prScene = { ...r, slug: promoSel }; drawPromoEditor(); }
    };
    head.append(num, type, bars, energy, play, up, down, del);
    box.appendChild(head);
    const t = document.createElement("div");
    t.className = "t";
    const st = timing.scenes[i];
    t.textContent = `${st ? `${st.start.toFixed(1)} s → ${(st.start + st.duration).toFixed(1)} s · ` : ""}${def?.hint || ""}`;
    box.appendChild(t);
    const fg = document.createElement("div");
    fg.className = "pr-grid";
    for (const f of def?.fields || []) {
      const multi = ["lines", "tuples", "rows"].includes(f.kind);
      const inp = prInput(prToText(f, prGet(sc.props, f.key)), (v) => prSet(sc.props, f.key, prFromText(f, v)),
        { area: multi, placeholder: f.placeholder || "" });
      fg.appendChild(prField(f.label, inp, multi || f.kind === "rich"));
    }
    const chip = prInput(sc.prompt, (v) => { if (v.trim()) sc.prompt = v.trim(); else delete sc.prompt; },
      { placeholder: "/commande affichée en bas (option, produits tech)" });
    fg.appendChild(prField("Pastille « /commande ✓ généré »", chip, true));
    box.appendChild(fg);
    if (prScene && prScene.index === i && prScene.slug === promoSel) {
      const pv = document.createElement("div");
      pv.className = "pr-scene-preview";
      pv.innerHTML = `<video src="${escapeHtml(prScene.video)}" controls autoplay playsinline></video>`
        + (prScene.report ? `<div class="pr-help">${escapeHtml(prScene.report).replace(/\n/g, "<br>")}</div>` : "");
      const close = document.createElement("button");
      close.textContent = "Fermer l'aperçu";
      close.onclick = () => { prScene = null; drawPromoEditor(); };
      pv.appendChild(close);
      box.appendChild(pv);
    }
    wrap.appendChild(box);
  });

  // ---- add a scene
  const add = document.createElement("div");
  add.className = "pr-add";
  const pick = prSelect([{ value: "", label: "Ajouter une scène…" }, ...prCat().scenes.map((t) => ({ value: t.type, label: `${t.label}${t.signature ? " ★" : ""}` }))], "", (v) => {
    if (!v) return;
    const def = prType(v);
    const scene = { type: v, bars: def.bars, energy: def.energy, props: {} };
    // Before the finale, if there is one.
    const at = promoSb.scenes.at(-1)?.type === "finale" ? promoSb.scenes.length - 1 : promoSb.scenes.length;
    promoSb.scenes.splice(at, 0, scene);
    markPromoDirty(); drawPromoEditor(); drawPromoSide();
  });
  add.appendChild(pick);
  const others = promoData.promos.filter((p) => p.slug !== promoSel && !p.error);
  if (others.length) {
    const imp = document.createElement("button");
    imp.textContent = "Reprendre une scène d'une autre promo…";
    imp.title = "Copie une scène réussie (et ses images) depuis une autre promo";
    imp.onclick = () => importPromoScene(others).catch((e) => toast(e.message));
    add.appendChild(imp);
  }
  wrap.appendChild(add);
  const sig = document.createElement("div");
  sig.className = "pr-help";
  sig.textContent = "★ = scène de ta signature (mots frappés, preuves chiffrées, avis, final).";
  wrap.appendChild(sig);
  el.appendChild(wrap);
}

async function importPromoScene(others) {
  const a = await dialog({ title: "Reprendre une scène", message: "Depuis quelle promo ?", choices: others.map((p) => ({ value: p.slug, label: p.title })), okLabel: "Suivant" });
  if (!a) return;
  const src = await api(`/api/promos/${a.choice}`);
  const b = await dialog({
    title: "Reprendre une scène", message: `Scènes de « ${src.storyboard.title || a.choice} » :`,
    choices: src.storyboard.scenes.map((sc, i) => ({ value: String(i), label: `${i + 1}. ${prType(sc.type)?.label || sc.type} — ${prSceneGist(sc)}` })),
    okLabel: "Ajouter",
  });
  if (!b) return;
  const { scene, copied } = await api(`/api/promos/${promoSel}/import-scene`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: a.choice, index: Number(b.choice) }),
  });
  const at = promoSb.scenes.at(-1)?.type === "finale" ? promoSb.scenes.length - 1 : promoSb.scenes.length;
  promoSb.scenes.splice(at, 0, scene);
  markPromoDirty(); drawPromoEditor(); drawPromoSide();
  toast(`Scène ajoutée${copied.length ? ` avec ${copied.length} image(s)` : ""}. Adapte ses textes, puis enregistre.`);
}

// A few words to recognise a scene in a list.
function prSceneGist(sc) {
  const p = sc.props || {};
  const first = p.title || p.headline || p.caption || p.big || p.question || (p.words || []).join(" ") || p.items?.[0]?.name || p.items?.[0]?.text || "";
  return String(Array.isArray(first) ? first.join(" ") : first).replace(/[*|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

function prTiming() {
  const bar = 240 / (promoSb.music.bpm || 120);
  let t = 0;
  const scenes = promoSb.scenes.map((sc) => { const s = { start: t, duration: sc.bars * bar }; t += sc.bars * bar; return s; });
  return { bar, scenes, total: t + 0.75 * bar };
}

async function savePromo() {
  if (!promoSb) return;
  promo = await api(`/api/promos/${promoSel}/storyboard`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(promoSb),
  });
  promoSb = JSON.parse(JSON.stringify(promo.storyboard));
  promoDirty = false;
  const i = promoData.promos.findIndex((p) => p.slug === promoSel);
  if (i >= 0) Object.assign(promoData.promos[i], { title: promoSb.title || promoSel, scenes: promoSb.scenes.length, duration: promo.timing.total, formats: promoSb.formats });
  drawPromoList();
  drawPromoEditor();
  drawPromoSide();
}

function promoStatus(text, isError) {
  const el = $("#pr-status");
  if (!el) return;
  el.className = "pr-status" + (isError ? " err" : "");
  el.textContent = text;
}

function waitPromoJob(id) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let job;
      try { job = await api(`/api/jobs/${id}`); } catch (e) { return reject(e); }
      const bar = $("#pr-prog");
      if (bar) bar.value = job.progress || 0;
      if (job.message) promoStatus(job.message + (job.progress > 0.01 && job.progress < 1 ? ` ${Math.round(job.progress * 100)} %` : ""));
      if (job.status === "done") return resolve(job);
      if (job.status === "error") return reject(new Error(job.error));
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function promoAction(kind, label, body) {
  if (promoBusy) return null;
  promoBusy = true;
  drawPromoSide();
  try {
    if (promoDirty) await savePromo();
    const { job } = await api(`/api/promos/${promoSel}/${kind}`, body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : { method: "POST" });
    const done = await waitPromoJob(job.id);
    await openPromo(promoSel);
    // The list shows « rendue », durations… : keep it in step.
    const i = promoData.promos.findIndex((p) => p.slug === promoSel);
    if (i >= 0) promoData.promos[i].lastRender = promo.renders[0] || null;
    drawPromoList();
    toast(`${label} : terminé.`);
    promoStatus(`${label} : terminé.`);
    return done.result;
  } catch (error) {
    promoStatus(error.message, true);
    return null;
  } finally {
    promoBusy = false;
    const bar = $("#pr-prog");
    if (bar) bar.value = 0;
    drawPromoSide(); // every button of the panel back on (engine, post…)
  }
}

function drawPromoSide() {
  const el = $("#promo-side");
  const keepStatus = $("#pr-status")?.textContent || "";
  el.innerHTML = "";
  if (!promoSb) return;
  const side = document.createElement("div");
  side.className = "pr-side";
  const t = prTiming();

  // ---- summary + warnings
  const sum = document.createElement("div");
  sum.className = "pr-box";
  sum.innerHTML = `<h3>Durée</h3><div style="font-size:20px;font-weight:700">${fmtSec(t.total)} <span style="font-size:12px;color:var(--muted);font-weight:400">· ${promoSb.scenes.length} scènes · ${promoSb.music.bpm} BPM</span></div>`;
  const warns = promoDirty ? [] : (promo.warnings || []);
  if (warns.length) {
    const w = document.createElement("div");
    w.className = "pr-warn";
    w.innerHTML = warns.map((x) => `<span>⚠︎ ${escapeHtml(x)}</span>`).join("");
    sum.appendChild(w);
  } else if (!promoDirty) {
    sum.insertAdjacentHTML("beforeend", `<div class="pr-ok">✓ Structure cohérente</div>`);
  }
  side.appendChild(sum);

  // ---- brand
  const br = document.createElement("div");
  br.className = "pr-box";
  br.innerHTML = `<h3>Charte</h3>`;
  const brands = state.brands || [];
  const cur = promo.brand?.studioBrandId || "";
  const sel = prSelect([{ value: "", label: promo.brand ? `${promo.brand.name} (hors studio)` : "Aucune" }, ...brands.map((b) => ({ value: b.id, label: b.name }))], cur, async (v) => {
    if (!v) return;
    try {
      promo = await api(`/api/promos/${promoSel}/brand`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId: v }) });
      toast("Charte appliquée à la promo. Relance un contrôle pour la voir.");
      drawPromoSide();
    } catch (error) { toast(error.message); }
  });
  br.appendChild(sel);
  if (promo.brand?.colors) {
    const sw = document.createElement("div");
    sw.className = "brand-swatches";
    sw.style.display = "flex"; sw.style.gap = "6px";
    const th = promo.brand.theme;
    sw.innerHTML = Object.values(promo.brand.colors).map((c) => `<span style="background:${escapeHtml(c)}"></span>`).join("")
      + `<span style="width:auto;border:0;font-size:11.5px;color:var(--muted)">${escapeHtml(promo.brand.fonts?.title?.family || "")} · ${escapeHtml(promo.brand.fonts?.body?.family || "")}</span>`;
    const tl = document.createElement("div");
    tl.className = "pr-help";
    tl.textContent = th
      ? `Thème du site : ${th.mode === "light" ? "clair" : "sombre"}${th.titleGradient ? " · titres en dégradé" : ""}${th.cta ? " · boutons du site" : ""}${th.logo ? " · logo adapté" : ""}`
      : "Pas encore de thème tiré du site : « Capturer le site » le calcule.";
    br.appendChild(sw);
    br.appendChild(tl);
  }
  side.appendChild(br);

  // ---- engine version
  if (promo.engine && !promo.engine.same) {
    const en = document.createElement("div");
    en.className = "pr-box";
    en.innerHTML = `<h3>Moteur</h3><div class="pr-help">${promo.engine.newer
      ? "Une version plus récente du moteur existe (corrections, contrôles, nouvelles scènes)."
      : "Ce moteur diffère du modèle de la skill (retouche propre à cette vidéo ?)."}</div>`;
    const up = document.createElement("button");
    up.textContent = "Mettre à jour le moteur";
    up.style.justifySelf = "start";
    up.disabled = promoBusy;
    up.onclick = async () => {
      if (!(await askConfirm("Mettre à jour le moteur", "Le moteur de cette promo est remplacé par celui de la skill. L'ancien part à la Corbeille (retouches propres à cette vidéo comprises). Le storyboard, la musique et les images ne changent pas. Relance ensuite un contrôle.", "Mettre à jour"))) return;
      try { promo = await api(`/api/promos/${promoSel}/engine`, { method: "POST" }); drawPromoSide(); toast("Moteur à jour. Lance « Contrôler » pour vérifier la vidéo."); }
      catch (error) { toast(error.message); }
    };
    en.appendChild(up);
    side.appendChild(en);
  }

  // ---- actions
  const act = document.createElement("div");
  act.className = "pr-box";
  act.innerHTML = `<h3>Actions</h3>`;
  const grid = document.createElement("div");
  grid.className = "pr-actions";
  const btn = (label, title, onClick, cls = "") => {
    const b = document.createElement("button");
    b.textContent = label; b.title = title; b.className = cls;
    b.disabled = promoBusy;
    b.onclick = onClick;
    grid.appendChild(b);
    return b;
  };
  const save = btn(promoDirty ? "Enregistrer *" : "Enregistré", "Écrit storyboard.json", () => savePromo().catch((e) => promoStatus(e.message, true)), "wide");
  save.id = "pr-save";
  save.disabled = !promoDirty || promoBusy;
  btn("Capturer le site", "Capture pleine page + analyse + thème de la vidéo (clair/sombre, dégradés, boutons du site)", () => promoAction("capture", "Capture"));
  btn("Nouvelle musique", "Tire une nouvelle musique pour cette promo (tonalité, accords, rythmes, timbres), calée sur les énergies des scènes", () => promoAction("music", "Musique"));
  btn("Contrôler", "Brouillon mi-résolution → planche de 2 images par scène + textes coupés ou qui se chevauchent + bords + niveau sonore", () => promoAction("check", "Contrôle"), "wide");
  btn("Aperçu interactif", "Ouvre Remotion Studio sur cette promo : lecture et navigation image par image, sans rendu", async () => {
    try {
      if (promoDirty) await savePromo();
      const { url } = await api(`/api/promos/${promoSel}/preview`, { method: "POST" });
      toast(`Remotion Studio s'ouvre dans ton navigateur (${url}) — ~10 s au premier lancement.`);
    } catch (error) { promoStatus(error.message, true); }
  });
  btn("Exporter la musique", "La musique seule (.m4a), à côté des vidéos, pour un autre montage", async () => {
    try { await api(`/api/promos/${promoSel}/music-export`, { method: "POST" }); toast("Musique exportée : le Finder l'affiche."); }
    catch (error) { promoStatus(error.message, true); }
  });
  btn("Rendre la vidéo finale", "Rendu Remotion + finition LinkedIn (H.264 yuv420p, AAC 48 kHz) + couverture, fiche Project Hub et texte du post", () => promoAction("render", "Rendu"), "primary wide");
  act.appendChild(grid);
  const prog = document.createElement("progress");
  prog.id = "pr-prog"; prog.max = 1; prog.value = 0; prog.style.width = "100%";
  act.appendChild(prog);
  const status = document.createElement("div");
  status.id = "pr-status"; status.className = "pr-status";
  status.textContent = keepStatus;
  act.appendChild(status);
  side.appendChild(act);

  // ---- renders
  if (promo.renders?.length) {
    const rb = document.createElement("div");
    rb.className = "pr-box";
    rb.innerHTML = `<h3>Vidéos rendues</h3>`;
    for (const r of promo.renders) {
      const item = document.createElement("div");
      item.className = "pr-render";
      item.innerHTML = `<video src="${escapeHtml(r.url)}?t=${Math.round(r.mtime)}" controls preload="metadata" playsinline${r.cover ? ` poster="${escapeHtml(r.cover)}"` : ""}></video>`;
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span class="grow">${escapeHtml(r.name)} · ${fmtBytes(r.size)} · ${fmtDate(r.mtime)}</span>`;
      const toClip = document.createElement("button");
      toClip.textContent = "Ajouter au montage";
      toClip.title = "Devient un clip du projet ouvert (sous-titres, effets…)";
      toClip.onclick = async () => {
        try {
          await api(`/api/promos/${promoSel}/clip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: r.name }) });
          await refresh();
          toast("Promo ajoutée comme clip au projet ouvert.");
        } catch (error) { toast(error.message); }
      };
      const drop = document.createElement("button");
      drop.textContent = "Supprimer";
      drop.title = "Mettre cette vidéo à la corbeille";
      drop.onclick = async () => {
        if (!(await askConfirm("Supprimer la vidéo", `« ${r.name} » part à la Corbeille du Mac (${fmtBytes(r.size)}). Le storyboard est conservé : tu pourras la rendre à nouveau.`, "Mettre à la corbeille"))) return;
        try {
          promo = await api(`/api/promos/${promoSel}/renders/${encodeURIComponent(r.name)}`, { method: "DELETE" });
          const i = promoData.promos.findIndex((x) => x.slug === promoSel);
          if (i >= 0) promoData.promos[i].lastRender = promo.renders[0] || null;
          drawPromoList();
          drawPromoSide();
          toast("Vidéo mise à la corbeille.");
        } catch (error) { toast(error.message); }
      };
      const reveal = document.createElement("button");
      reveal.textContent = "Finder";
      reveal.onclick = () => api(`/api/promos/${promoSel}/reveal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: r.name }) });
      row.append(toClip, reveal, drop);
      item.appendChild(row);
      const pub = document.createElement("div");
      pub.className = "row";
      if (r.cover) {
        const cv = document.createElement("a");
        cv.href = r.cover; cv.target = "_blank"; cv.rel = "noopener"; cv.textContent = "Couverture";
        cv.title = "Image de couverture (miniature LinkedIn) — clic droit pour l'enregistrer";
        pub.appendChild(cv);
      }
      const hub = document.createElement("button");
      hub.textContent = "Publier sur Project Hub";
      hub.title = "Copie la demande à coller dans Claude : envoi dans le bucket, fiche technique, jamais « sur le site » sans ton accord";
      hub.onclick = async () => {
        const text = `Publie la vidéo ~/Code/promos/${promoSel}/out/${r.name} sur Project Hub (skill promo-site, étape 6). La fiche est prête : ~/Code/promos/${promoSel}/out/publish.json.`;
        try { await navigator.clipboard.writeText(text); toast("Demande copiée : colle-la dans une session Claude."); }
        catch { await askText("Copie cette demande pour Claude", text, "Fermer"); }
      };
      pub.appendChild(hub);
      item.appendChild(pub);
      rb.appendChild(item);
    }
    side.appendChild(rb);
  }

  // ---- LinkedIn post
  const post = document.createElement("div");
  post.className = "pr-box";
  post.innerHTML = `<h3>Post LinkedIn</h3>`;
  const draft = prDraft?.slug === promoSel ? prDraft.text : "";
  const ta = document.createElement("textarea");
  ta.className = "pr-post";
  ta.rows = 10;
  ta.value = promoSb.post || draft;
  ta.placeholder = "Brouillon en cours de préparation…";
  const count = document.createElement("div");
  count.className = "pr-help";
  const upd = () => { count.textContent = `${ta.value.length} / 3000 caractères · ${promoSb.post ? "ton texte" : "brouillon tiré du storyboard (à retoucher)"}`; };
  ta.oninput = () => { promoSb.post = ta.value; markPromoDirty(); upd(); };
  upd();
  const prow = document.createElement("div");
  prow.className = "row";
  const cp = document.createElement("button");
  cp.textContent = "Copier le texte";
  cp.onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast("Texte du post copié."); }
    catch { ta.select(); toast("Sélectionné : Cmd+C pour copier."); }
  };
  const reset = document.createElement("button");
  reset.textContent = "Revenir au brouillon";
  reset.title = "Oublie ton texte et reprend le brouillon tiré du storyboard";
  reset.disabled = !promoSb.post;
  reset.onclick = () => { delete promoSb.post; markPromoDirty(); prDraft = null; drawPromoSide(); };
  prow.append(cp, reset);
  post.append(ta, count, prow);
  if ((promoSb.invented || []).length) {
    post.insertAdjacentHTML("beforeend", `<div class="pr-warn"><span>⚠︎ Éléments inventés dans la vidéo : vérifie que le post n'en affirme aucun.</span></div>`);
  }
  side.appendChild(post);
  if (!promoSb.post && prDraft?.slug !== promoSel) {
    const slug = promoSel;
    api(`/api/promos/${slug}/post-draft`).then(({ text }) => {
      prDraft = { slug, text };
      if (promoSel === slug && !promoSb.post && document.activeElement !== ta) { ta.value = text; upd(); }
    }).catch(() => { ta.placeholder = "Brouillon indisponible : écris ton texte ici."; });
  }

  // ---- check sheet
  if (promo.sheet) {
    const sb = document.createElement("div");
    sb.className = "pr-box pr-sheet";
    sb.innerHTML = `<h3>Dernier contrôle</h3><a href="${escapeHtml(promo.sheet)}" target="_blank" rel="noopener"><img src="${escapeHtml(promo.sheet)}" alt="Planche de contrôle"></a>`
      + (promo.check ? `<div class="pr-help">${escapeHtml(promo.check).replace(/\n/g, "<br>")}</div>` : "");
    side.appendChild(sb);
  }
  if (promo.shot) {
    const sh = document.createElement("div");
    sh.className = "pr-box pr-shot";
    sh.innerHTML = `<h3>Capture du site</h3><img src="${escapeHtml(promo.shot)}" alt="Capture du site">`;
    side.appendChild(sh);
  }

  // ---- Claude
  const help = document.createElement("div");
  help.className = "pr-box";
  help.innerHTML = `<h3>Avec Claude</h3><div class="pr-help">Le storyboard complet (textes tirés du site, du backoffice et de ton brief, charte, logo) s'écrit avec Claude et la skill <code>promo-site</code>. Ici, tu retouches, contrôles et rends sans consommer de quota.</div>`;
  const copy = document.createElement("button");
  copy.textContent = "Copier une demande pour Claude";
  copy.style.justifySelf = "start";
  copy.onclick = async () => {
    const text = `Avec la skill promo-site, reprends la promo « ${promoSb.title || promoSel} » (~/Code/promos/${promoSel}${promoSb.url ? `, site ${promoSb.url}` : ""}) : `;
    try { await navigator.clipboard.writeText(text); toast("Demande copiée : colle-la à Claude et complète-la."); }
    catch { await askText("Copie cette demande pour Claude", text, "Fermer"); }
  };
  help.appendChild(copy);
  side.appendChild(help);

  el.appendChild(side);
}

// Cmd/Ctrl+S saves the storyboard while the Promos tab is open.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s" && !$("#view-promos").hidden && promoSb) {
    e.preventDefault();
    if (promoDirty) savePromo().then(() => toast("Storyboard enregistré.")).catch((err) => toast(err.message));
  }
});
// Leaving the page with an unsaved storyboard asks first (the browser's own prompt).
window.addEventListener("beforeunload", (e) => {
  if (promoDirty) { e.preventDefault(); e.returnValue = ""; }
});

$("#new-promo").onclick = async () => {
  if (!promoData) return toast("L'onglet Promos n'a pas pu se charger : relance le studio.");
  if (!promoData.hasSkill) return toast("Skill promo-site introuvable.");
  const title = await askText("Nouvelle promo — nom du site ou du projet", "", "Suivant");
  if (!title) return;
  const url = await askText("Adresse du site (optionnel)", "https://", "Créer");
  if (url === null) return;
  try {
    const { job } = await api("/api/promos", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, url: url === "https://" ? "" : url }),
    });
    toast("Création de la promo…");
    const done = await waitPromoJob(job.id);
    promoSel = done.result.slug;
    promo = null;
    await drawPromos();
    toast("Promo créée. Pour un storyboard complet, demande à Claude (skill promo-site).");
  } catch (error) {
    toast(error.message);
  }
};
