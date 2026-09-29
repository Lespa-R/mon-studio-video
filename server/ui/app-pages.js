// Mon Studio Vidéo — interface (app-pages.js).
// Tabs, output format, brand kit page.
// Classic scripts sharing one global scope, loaded in order by index.html
// (no build, no modules): top-level code may only use what earlier files
// define; functions called later (handlers, boot) may live in any file.

// ------------------------------------------------------------- tabs

function showView(which) {
  $("#view-edit").hidden = which !== "edit";
  $("#view-lib").hidden = which !== "lib";
  $("#view-brand").hidden = which !== "brand";
  $("#view-storage").hidden = which !== "storage";
  $("#view-promos").hidden = which !== "promos";
  document.body.classList.toggle("on-edit", which === "edit");
  $("#tab-storage").classList.toggle("on", which === "storage");
  $("#tab-promos").classList.toggle("on", which === "promos");
  $("#tab-edit").classList.toggle("on", which === "edit");
  $("#tab-lib").classList.toggle("on", which === "lib");
  $("#tab-brand").classList.toggle("on", which === "brand");
  if (which === "storage") { drawStorage(); return; }
  if (which === "promos") { drawPromos(); return; }
  if (which === "brand") {
    if (!brandSel) brandSel = state.brandId || state.brands[0]?.id || "default";
    drawBrandPage();
    return;
  }
  if (which === "lib") {
    if (!libPreset) libPreset = visiblePresets()[0]?.id || null;
    drawEffectLibrary();
    previewPreset();
  } else {
    const v = videoById(selected);
    const iframe = $("#frame iframe");
    // The splitters are placed from widths measured while visible.
    requestAnimationFrame(applyLayout);
    if (v && brandDirty) { brandDirty = false; preview(); }
    else if (v && iframe) fitFrame(iframe, v, $("#frame"));
  }
}
$("#tab-edit").onclick = () => showView("edit");
$("#tab-lib").onclick = () => showView("lib");
$("#tab-brand").onclick = () => showView("brand");
$("#tab-storage").onclick = () => showView("storage");
$("#tab-promos").onclick = () => showView("promos");


// ================================================== output format

// ----------------------------------------------------- output format

function drawFormat() {
  if (!state.options || !state.format) return;
  const f = state.format;
  const fill = (sel, list, value) => {
    const el = $(sel);
    el.innerHTML = "";
    for (const o of list) {
      const opt = document.createElement("option");
      opt.value = String(o.value);
      opt.textContent = o.label;
      if (String(o.value) === String(value)) opt.selected = true;
      el.appendChild(opt);
    }
  };
  fill("#f-aspect", state.options.aspects, f.aspect);
  fill("#f-size", state.options.sizes, f.size);
  fill("#f-fit", state.options.fits, f.fit);
  fill("#f-focus", state.options.focuses, f.focus);
  fill("#f-fill", state.options.fills, f.fill);
  fill("#f-brand", [
    { value: "", label: "Studio (par défaut)" },
    ...state.brands.map((b) => ({ value: b.id, label: b.name })),
  ], state.brandId || "");
  // Point focal only matters when cropping, the fill only with bands.
  $("#f-focus-wrap").hidden = f.fit !== "cover";
  $("#f-fill-wrap").hidden = f.fit !== "contain";
}

for (const [id, key] of [["#f-aspect", "aspect"], ["#f-size", "size"], ["#f-fit", "fit"],
                         ["#f-focus", "focus"], ["#f-fill", "fill"]]) {
  $(id).onchange = async () => {
    const raw = $(id).value;
    const value = key === "size" && raw !== "source" ? Number(raw) : raw;
    await api(`/api/projects/${state.activeProject}/format`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    await refresh();
    preview();
  };
}


$("#f-brand").onchange = async () => {
  await api(`/api/projects/${state.activeProject}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brandId: $("#f-brand").value || null }),
  });
  await refresh();
  preview();
};


// ================================================= brand kit page

let brandSel = null; // "default" | <brandId>

// Imported fonts are declared in this page too, so the pickers and the
// sample show them — under a family name of their own per file.
function declareFonts() {
  let style = $("#user-fonts");
  if (!style) {
    style = document.createElement("style");
    style.id = "user-fonts";
    document.head.appendChild(style);
  }
  style.textContent = (state.fonts || []).map((f) =>
    `@font-face { font-family: "uf-${f.file}"; src: url("/media/${encodeURIComponent(f.file)}"); }`).join("\n");
}

// The CSS font-family for a brand font value, as the composition has it.
function fontCss(value) {
  if (String(value).startsWith("file:")) return `"uf-${value.slice(5)}", -apple-system, system-ui, sans-serif`;
  if (!value || value === "system") return `-apple-system, "SF Pro Display", system-ui, sans-serif`;
  return `"${value}", -apple-system, system-ui, sans-serif`;
}

const DEFAULT_BRAND_VIEW = () => state.defaultBrand || {
  id: null, name: "Studio (par défaut)",
  colors: { primary: "#4f8cff", secondary: "#6d28d9", text: "#ffffff", surface: "#080e1a" },
  fonts: { title: "system", body: "system" }, logo: "",
};

function currentBrand() {
  if (brandSel === "default") return DEFAULT_BRAND_VIEW();
  return state.brands.find((b) => b.id === brandSel) || null;
}

// Set when the kit changes, so the editor's preview is rebuilt on return.
let brandDirty = false;

async function patchBrand(id, body) {
  brandDirty = true;
  await api(`/api/brands/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await refresh();
}

function drawBrandList() {
  const el = $("#brand-list");
  el.innerHTML = "";
  const usedBy = (id) => state.projects.filter((p) => (p.brandId || null) === id).length;
  const row = (id, name, count) => {
    const div = document.createElement("div");
    div.className = "tree-row" + (brandSel === id ? " on" : "");
    const b = id === "default" ? DEFAULT_BRAND_VIEW() : state.brands.find((x) => x.id === id);
    div.innerHTML = `<span style="display:flex;gap:3px">${["primary", "secondary", "text", "surface"].map((k) =>
        `<span style="width:9px;height:9px;border-radius:50%;background:${b.colors[k]};border:1px solid var(--line)"></span>`).join("")}</span>
      <span class="grow">${escapeHtml(name)}</span>
      <span class="count" title="Projets qui l'utilisent">${count || ""}</span>`;
    div.onclick = () => { brandSel = id; drawBrandPage(); };
    el.appendChild(div);
  };
  row("default", "Studio (par défaut)", usedBy(null));
  for (const b of state.brands) row(b.id, b.name, usedBy(b.id));
}

function drawBrandEditor() {
  const el = $("#brand-editor");
  el.innerHTML = "";
  const brand = currentBrand();
  if (!brand) return;

  if (brandSel === "default") {
    const note = document.createElement("div");
    note.className = "readonly";
    note.innerHTML = `La charte par défaut du studio : bleu, blanc, police système, sans logo.
      Elle ne se modifie pas — crée ta charte avec <b>+ Charte</b> (elle part de celle-ci),
      puis choisis-la pour un projet dans la barre « Charte » du montage.`;
    el.appendChild(note);
    const make = document.createElement("button");
    make.className = "primary";
    make.textContent = "Créer ma charte";
    make.onclick = () => $("#new-brand").click();
    el.appendChild(make);
    return;
  }

  const name = document.createElement("input");
  name.type = "text";
  name.className = "name";
  name.value = brand.name;
  name.onchange = () => patchBrand(brand.id, { name: name.value.trim() || brand.name });
  el.appendChild(name);

  // Colours: picker + hex box, per role.
  const h1 = document.createElement("h3");
  h1.textContent = "Couleurs";
  el.appendChild(h1);
  const colors = document.createElement("div");
  colors.className = "colors";
  for (const role of state.options.colorRoles) {
    const label = document.createElement("label");
    label.innerHTML = `<span>${escapeHtml(role.label)}</span>`;
    const pair = document.createElement("div");
    pair.className = "pair";
    const pick = document.createElement("input");
    pick.type = "color";
    pick.value = brand.colors[role.key];
    const hex = document.createElement("input");
    hex.type = "text";
    hex.value = brand.colors[role.key];
    hex.maxLength = 7;
    const save = (v) => patchBrand(brand.id, { colors: { [role.key]: v } }).then(() => { if (!$("#view-brand").hidden) drawBrandPreview(); });
    pick.oninput = () => { hex.value = pick.value; drawBrandPreview({ [role.key]: pick.value }); };
    pick.onchange = () => save(pick.value);
    hex.onchange = () => {
      const v = hex.value.trim().startsWith("#") ? hex.value.trim() : "#" + hex.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) save(v.toLowerCase());
      else { hex.value = brand.colors[role.key]; toast("Couleur attendue au format #RRGGBB, par exemple #4f8cff."); }
    };
    pair.append(pick, hex);
    label.appendChild(pair);
    colors.appendChild(label);
  }
  el.appendChild(colors);

  // Fonts: system fonts + imported ones.
  const h2 = document.createElement("h3");
  h2.textContent = "Polices";
  el.appendChild(h2);
  for (const [role, label] of [["title", "Titres"], ["body", "Textes"]]) {
    const row = document.createElement("div");
    row.className = "fontrow";
    row.innerHTML = `<span>${label}</span>`;
    const sel = document.createElement("select");
    const sys = document.createElement("optgroup");
    sys.label = "Polices du Mac";
    for (const f of state.options.fonts) {
      const opt = document.createElement("option");
      opt.value = f.value; opt.textContent = f.label;
      opt.style.fontFamily = fontCss(f.value);
      sys.appendChild(opt);
    }
    sel.appendChild(sys);
    if ((state.fonts || []).length) {
      const mine = document.createElement("optgroup");
      mine.label = "Mes polices importées";
      for (const f of state.fonts) {
        const opt = document.createElement("option");
        opt.value = "file:" + f.file; opt.textContent = f.name;
        mine.appendChild(opt);
      }
      sel.appendChild(mine);
    }
    sel.value = brand.fonts[role];
    sel.style.fontFamily = fontCss(brand.fonts[role]);
    sel.onchange = () => patchBrand(brand.id, { fonts: { [role]: sel.value } });
    row.appendChild(sel);
    el.appendChild(row);
  }
  const fontBtns = document.createElement("div");
  fontBtns.className = "fontbtns";
  const importFont = document.createElement("button");
  importFont.textContent = "Importer une police…";
  const fontFile = document.createElement("input");
  fontFile.type = "file";
  fontFile.accept = ".woff2,.woff,.ttf,.otf";
  fontFile.hidden = true;
  importFont.onclick = () => fontFile.click();
  fontFile.onchange = async () => {
    const file = fontFile.files && fontFile.files[0];
    if (!file) return;
    importFont.disabled = true;
    importFont.textContent = "Envoi…";
    try {
      const { file: stored } = await api("/api/assets", {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(file.name) },
        body: file,
      });
      // A kit with the system font for titles takes the new one there.
      const role = brand.fonts.title === "system" ? "title" : "body";
      await patchBrand(brand.id, { fonts: { [role]: "file:" + stored } });
    } finally {
      importFont.disabled = false;
      importFont.textContent = "Importer une police…";
    }
  };
  const tip = document.createElement("span");
  tip.className = "hint";
  tip.style.padding = "0";
  tip.textContent = "WOFF2, WOFF, TTF ou OTF — par exemple depuis Google Fonts.";
  fontBtns.append(importFont, fontFile);
  el.appendChild(fontBtns);
  el.appendChild(tip);

  // Logo: the same image picker as the effects.
  const h3 = document.createElement("h3");
  h3.textContent = "Logo";
  el.appendChild(h3);
  el.appendChild(field(
    { key: "logo", label: "Image", type: "image", default: "" },
    brand.logo,
    (value) => patchBrand(brand.id, { logo: value }),
    "brand-" + brand.id,
  ));
  if (brand.logo) {
    const drop = document.createElement("button");
    drop.textContent = "Retirer le logo";
    drop.style.fontSize = "12px";
    drop.onclick = () => patchBrand(brand.id, { logo: "" });
    el.appendChild(drop);
  }
  const logoTip = document.createElement("div");
  logoTip.className = "hint";
  logoTip.style.padding = "0";
  logoTip.textContent = "Un PNG à fond transparent rend le mieux. L'élément « Logo » l'utilise.";
  el.appendChild(logoTip);

  const zone = document.createElement("div");
  zone.className = "danger-zone";
  const dup = document.createElement("button");
  dup.textContent = "Dupliquer";
  dup.onclick = async () => {
    const { brand: copy } = await api("/api/brands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `${brand.name} (copie)`, from: brand.id }),
    });
    brandSel = copy.id;
    await refresh();
  };
  const del = document.createElement("button");
  del.textContent = "Supprimer";
  del.onclick = async () => {
    const n = state.projects.filter((p) => p.brandId === brand.id).length;
    if (!(await askConfirm("Supprimer cette charte ?",
      `« ${brand.name} »${n ? ` est utilisée par ${n} projet${n > 1 ? "s" : ""}, qui reviendront à la charte par défaut` : ""}.`))) return;
    await api(`/api/brands/${brand.id}`, { method: "DELETE" });
    brandSel = "default";
    await refresh();
  };
  zone.append(dup, del);
  el.appendChild(zone);
}

// A still sample of the kit: a title, a lower third, a button, the logo.
function drawBrandPreview(override = {}) {
  const el = $("#brand-preview");
  const brand = currentBrand();
  if (!brand) { el.innerHTML = ""; return; }
  const c = { ...brand.colors, ...override };
  const title = fontCss(brand.fonts.title);
  const body = fontCss(brand.fonts.body);
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  el.innerHTML = `
    <div class="brand-card">
      <div class="bp-title" style="color:${c.text};font-family:${escapeHtml(title)}">Mon titre</div>
      <div class="bp-lt">
        <div class="bp-bar" style="background:${c.primary}"></div>
        <div class="bp-body" style="background:${rgba(c.surface, 0.62)};color:${c.text}">
          <div class="bp-t" style="font-family:${escapeHtml(title)}">Robin</div>
          <div class="bp-s" style="font-family:${escapeHtml(body)}">Data &amp; Dev</div>
        </div>
      </div>
      <div class="bp-cta" style="background:${c.primary};color:${c.text};font-family:${escapeHtml(title)}">Abonne-toi</div>
      ${brand.logo ? `<img class="bp-logo" src="/media/${encodeURIComponent(brand.logo)}" alt="" />` : ""}
    </div>
    <div class="brand-swatches">${state.options.colorRoles.map((r) =>
      `<div><span style="background:${c[r.key]}"></span>${escapeHtml(r.label)}</div>`).join("")}</div>
    <div class="brand-note">Dans les effets, clique une pastille de couleur pour la lier à la charte :
      elle suivra alors chaque changement fait ici. Les titres, bandeaux et animations
      prennent les polices de la charte.</div>`;
}

function drawBrandPage() {
  declareFonts();
  if (brandSel !== "default" && !state.brands.some((b) => b.id === brandSel)) brandSel = "default";
  drawBrandList();
  drawBrandEditor();
  drawBrandPreview();
}

$("#new-brand").onclick = async () => {
  const name = await askText("Nouvelle charte", "Ma charte", "Créer");
  if (!name) return;
  const { brand } = await api("/api/brands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, from: brandSel !== "default" ? brandSel : null }),
  });
  brandSel = brand.id;
  // A first kit is also what the open project wants, most likely.
  if (!state.brandId) {
    await api(`/api/projects/${state.activeProject}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId: brand.id }),
    });
  }
  await refresh();
};
