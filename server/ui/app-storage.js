// Mon Studio HyperFrame — interface (app-storage.js).
// Storage page: what takes space, what can go.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ===================================================== storage

const fmtBytes = (n) => {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${units[i]}`;
};
const fmtDate = (ms) => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const KIND_COLORS = {
  source: "#4f8cff", original: "#8b5cf6", matte: "#22c1c3", people: "#14b8a6",
  render: "#f59e0b", asset: "#ec4899", orphan: "#ef4444", temp: "#94a3b8", state: "#64748b",
};

async function deleteFiles(items, title, message, okLabel = "Supprimer") {
  if (!items.length) return;
  const size = items.reduce((s, x) => s + x.size, 0);
  if (!(await askConfirm(title, `${message}\n\n${items.length} fichier${items.length > 1 ? "s" : ""} · ${fmtBytes(size)} libérés.`, okLabel))) return;
  const r = await api("/api/storage/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targets: items.map((x) => ({ area: x.area, name: x.name })) }),
  });
  toast(`${fmtBytes(r.freed)} libérés${r.skipped.length ? ` · ${r.skipped.length} fichier(s) en cours d'utilisation, laissé(s) de côté` : ""}.`);
  await refresh();
  drawStorage();
}

async function drawStorage() {
  const el = $("#storage");
  let data;
  try {
    data = await api("/api/storage");
  } catch (error) {
    el.innerHTML = `<div class="st-empty">${escapeHtml(error.message)}</div>`;
    return;
  }
  const { items, totals, total, disk, kinds } = data;
  const by = (kind) => items.filter((x) => x.kind === kind);
  const sum = (list) => list.reduce((s, x) => s + x.size, 0);
  el.innerHTML = "";

  // ---- summary
  const summary = document.createElement("div");
  summary.className = "st-sec";
  const low = disk && disk.free / disk.total < 0.1;
  summary.innerHTML = `
    <div class="st-sum">
      <div class="st-big">Le studio occupe ${fmtBytes(total)}</div>
      ${disk ? `<div class="st-disk${low ? " low" : ""}">Il reste ${fmtBytes(disk.free)} libres sur ton disque (${Math.round((disk.free / disk.total) * 100)} %)</div>` : ""}
    </div>`;
  const bar = document.createElement("div");
  bar.className = "st-bar";
  const legend = document.createElement("div");
  legend.className = "st-legend";
  for (const kind of Object.keys(kinds)) {
    if (!totals[kind]) continue;
    const seg = document.createElement("div");
    seg.style.width = (totals[kind] / total) * 100 + "%";
    seg.style.background = KIND_COLORS[kind];
    seg.title = `${kinds[kind].label} : ${fmtBytes(totals[kind])}`;
    bar.appendChild(seg);
    legend.insertAdjacentHTML("beforeend",
      `<span title="${escapeHtml(kinds[kind].hint)}"><i style="background:${KIND_COLORS[kind]}"></i>${escapeHtml(kinds[kind].label)} <b>${fmtBytes(totals[kind])}</b></span>`);
  }
  summary.append(bar, legend);
  summary.style.display = "grid";
  summary.style.gap = "10px";
  el.appendChild(summary);

  // ---- quick clean-ups
  const quick = document.createElement("div");
  quick.className = "st-sec";
  quick.innerHTML = "<h3>Faire de la place</h3>";
  const cards = document.createElement("div");
  cards.className = "st-cards";
  const card = (title, list, hint, button, onClick) => {
    const size = sum(list);
    const c = document.createElement("div");
    c.className = "st-card";
    c.innerHTML = `<div class="t">${escapeHtml(title)}</div><div class="n">${fmtBytes(size)}</div><div class="h">${escapeHtml(hint)}</div>`;
    const b = document.createElement("button");
    b.textContent = button;
    b.disabled = !list.length;
    b.onclick = onClick;
    c.appendChild(b);
    cards.appendChild(c);
  };
  const caches = items.filter((x) => (x.kind === "matte" || x.kind === "people" || x.kind === "temp") && x.deletable);
  card("Caches recalculables", caches,
    "Découpes, suivis et fichiers de travail. Sans risque : recalculés au prochain aperçu (quelques secondes à quelques minutes).",
    "Vider les caches", () => deleteFiles(caches, "Vider les caches ?",
      "Les découpes et suivis seront recalculés au prochain aperçu de chaque clip."));
  const orphans = by("orphan").filter((x) => x.deletable);
  card("Fichiers orphelins", orphans, kinds.orphan.hint, "Supprimer",
    () => deleteFiles(orphans, "Supprimer les fichiers orphelins ?", "Aucun clip ni effet ne s'en sert."));
  const unused = by("asset").filter((x) => x.deletable);
  card("Images et polices inutilisées", unused, "Importées puis plus utilisées par aucun effet, préréglage ni charte.", "Supprimer",
    () => deleteFiles(unused, "Supprimer les images et polices inutilisées ?", "Elles ne servent à aucun effet, préréglage ni charte."));
  const originals = by("original").filter((x) => x.deletable);
  card("Originaux gardés après rognage", originals, kinds.original.hint, "Rendre les rognages définitifs",
    () => deleteFiles(originals, "Rendre les rognages définitifs ?",
      "Tu ne pourras plus rallonger ces clips ni revenir à la vidéo entière.", "Rendre définitif"));
  const renders = by("render");
  card("Rendus MP4", renders, "Tes exports. Déplace ceux à garder (bouton Finder ci-dessous), supprime les autres.",
    "Voir la liste", () => document.getElementById("st-renders").scrollIntoView({ behavior: "smooth" }));
  quick.appendChild(cards);
  el.appendChild(quick);

  // ---- per clip
  const clips = new Map();
  for (const it of items.filter((x) => x.videoId)) {
    if (!clips.has(it.videoId)) clips.set(it.videoId, { clip: it.clip, project: it.project, files: [] });
    clips.get(it.videoId).files.push(it);
  }
  const clipSec = document.createElement("div");
  clipSec.className = "st-sec";
  clipSec.innerHTML = "<h3>Par clip</h3>";
  if (!clips.size) clipSec.insertAdjacentHTML("beforeend", '<div class="st-empty">Aucun clip.</div>');
  else {
    const table = document.createElement("table");
    table.className = "st-table";
    table.innerHTML = "<tr><th>Clip</th><th>Fichiers</th><th style=\"text-align:right\">Total</th></tr>";
    const rows = [...clips.values()].sort((a, b) => sum(b.files) - sum(a.files));
    const names = { source: "vidéo", original: "original", matte: "découpe", people: "suivi" };
    for (const c of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(c.clip)}<div class="sub">${escapeHtml(c.project)}</div></td><td></td><td class="num">${fmtBytes(sum(c.files))}</td>`;
      for (const f of c.files.sort((a, b) => b.size - a.size)) {
        const chip = document.createElement("span");
        chip.className = "st-chip";
        chip.innerHTML = `<i style="width:8px;height:8px;border-radius:2px;background:${KIND_COLORS[f.kind]}"></i>${names[f.kind] || f.kind} ${fmtBytes(f.size)}`;
        if (f.deletable) {
          const x = document.createElement("button");
          x.textContent = f.kind === "original" ? "rendre définitif" : "vider";
          x.title = kinds[f.kind].hint;
          x.onclick = () => deleteFiles([f],
            f.kind === "original" ? "Rendre ce rognage définitif ?" : "Vider ce cache ?",
            f.kind === "original" ? "Tu ne pourras plus rallonger ce clip." : "Il sera recalculé au prochain aperçu de ce clip.",
            f.kind === "original" ? "Rendre définitif" : "Vider");
          chip.appendChild(x);
        }
        tr.children[1].appendChild(chip);
      }
      table.appendChild(tr);
    }
    clipSec.appendChild(table);
  }
  el.appendChild(clipSec);

  // ---- renders
  const rSec = document.createElement("div");
  rSec.className = "st-sec";
  rSec.id = "st-renders";
  rSec.innerHTML = `<h3>Rendus MP4 · ${fmtBytes(sum(renders))}</h3>`;
  if (!renders.length) rSec.insertAdjacentHTML("beforeend", '<div class="st-empty">Aucun rendu.</div>');
  else {
    const table = document.createElement("table");
    table.className = "st-table";
    table.innerHTML = "<tr><th>Fichier</th><th>Date</th><th style=\"text-align:right\">Poids</th><th></th></tr>";
    for (const r of [...renders].sort((a, b) => b.mtime - a.mtime)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td class="sub">${fmtDate(r.mtime)}</td><td class="num">${fmtBytes(r.size)}</td><td><div class="st-row-actions"></div></td>`;
      const actions = tr.querySelector(".st-row-actions");
      const open = document.createElement("a");
      open.href = `/renders/${encodeURIComponent(r.name)}`;
      open.target = "_blank";
      open.textContent = "Ouvrir";
      const finder = document.createElement("button");
      finder.textContent = "Finder";
      finder.title = "Afficher dans le Finder, pour le déplacer ailleurs";
      finder.onclick = () => api("/api/storage/reveal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ area: r.area, name: r.name }),
      });
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "Supprimer";
      del.disabled = !r.deletable;
      del.onclick = () => deleteFiles([r], "Supprimer ce rendu ?", r.name);
      actions.append(open, finder, del);
      table.appendChild(tr);
    }
    rSec.appendChild(table);
    const all = document.createElement("button");
    all.textContent = "Supprimer tous les rendus";
    all.style.cssText = "margin-top:10px;font-size:12px";
    all.onclick = () => deleteFiles(renders.filter((x) => x.deletable), "Supprimer tous les rendus ?",
      "Pense à déplacer d'abord ceux que tu veux garder.");
    rSec.appendChild(all);
  }
  el.appendChild(rSec);

  // ---- promos (hors du dossier du studio : informatif, suppression dans l'onglet Promos)
  if (data.promos && (data.promos.items.length || data.promos.engine)) {
    const pr = data.promos;
    const pSec = document.createElement("div");
    pSec.className = "st-sec";
    pSec.innerHTML = `<h3>Promos Remotion · ${fmtBytes(pr.total)} <span style="text-transform:none;letter-spacing:0;font-weight:400">— hors du studio, dans ${escapeHtml(pr.folder)}</span></h3>`;
    const table = document.createElement("table");
    table.className = "st-table";
    table.innerHTML = "<tr><th>Promo</th><th style=\"text-align:right\">Poids</th></tr>"
      + pr.items.map((x) => `<tr><td>${escapeHtml(x.slug)}</td><td class="num">${fmtBytes(x.size)}</td></tr>`).join("")
      + `<tr><td class="sub">Moteur Remotion partagé (node_modules, à garder)</td><td class="num">${fmtBytes(pr.engine)}</td></tr>`;
    pSec.appendChild(table);
    const go = document.createElement("button");
    go.textContent = "Gérer dans l'onglet Promos";
    go.style.cssText = "margin-top:10px;font-size:12px";
    go.onclick = () => showView("promos");
    pSec.appendChild(go);
    el.appendChild(pSec);
  }

  // ---- assets
  const assets = by("asset");
  const aSec = document.createElement("div");
  aSec.className = "st-sec";
  aSec.innerHTML = `<h3>Images et polices · ${fmtBytes(sum(assets))}</h3>`;
  if (!assets.length) aSec.insertAdjacentHTML("beforeend", '<div class="st-empty">Aucune image ni police importée.</div>');
  else {
    const grid = document.createElement("div");
    grid.className = "st-assets";
    const fontName = (file) => (state.fonts || []).find((f) => f.file === file)?.name || "Police";
    for (const a of [...assets].sort((x, y) => Number(x.used) - Number(y.used) || y.size - x.size)) {
      const box = document.createElement("div");
      box.className = "st-asset";
      box.innerHTML = `
        <div class="img" style="${a.font ? "" : `background-image:url('/media/${encodeURIComponent(a.name)}')`}">${a.font ? "Aa" : ""}</div>
        <div>${a.font ? escapeHtml(fontName(a.name)) : ""} ${fmtBytes(a.size)}</div>
        <div class="${a.used ? "u" : "x"}">${a.used ? "utilisée" : "inutilisée"}</div>`;
      if (a.deletable) {
        const b = document.createElement("button");
        b.textContent = "Supprimer";
        b.style.fontSize = "11px";
        b.onclick = () => deleteFiles([a], "Supprimer ce fichier ?", "Il ne sert à aucun effet, préréglage ni charte.");
        box.appendChild(b);
      }
      grid.appendChild(box);
    }
    aSec.appendChild(grid);
  }
  el.appendChild(aSec);

  el.insertAdjacentHTML("beforeend",
    `<div class="st-foot">Dossier du studio : ${escapeHtml(data.folder)} — les vidéos d'origine que tu as importées depuis ton Mac ne sont jamais touchées : le studio travaille sur ses propres copies.</div>`);
}
