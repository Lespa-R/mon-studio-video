// Promos: motion-design videos for a website, rendered with Remotion.
//
// A promo is not a clip with effects: it is a storyboard of scenes (the skill
// `promo-site` writes it, Claude fills it from the site), rendered by the
// Remotion engine that lives in its own workspace (~/Code/promos, one shared
// npm install). The studio stays dependency-free: it edits storyboard.json,
// hands its brand kits over, and shells out to the skill's scripts.
//
// This module is pure: catalogue, validation, timing, warnings, the line-based
// form representation of scene props, and the brand.json a promo reads.

export const ENERGIES = [
  { value: "intro", label: "Intro" },
  { value: "drop", label: "Drop (plein régime)" },
  { value: "break", label: "Pause" },
  { value: "build", label: "Montée" },
  { value: "finale", label: "Final" },
];

export const MOODS = [
  { value: "electro", label: "Électro", bpm: 120 },
  { value: "chill", label: "Chill", bpm: 96 },
  { value: "epic", label: "Épique", bpm: 108 },
  { value: "soft", label: "Douce (fond de voix off)", bpm: 96 },
];

export const PROMO_FORMATS = [
  { value: "4:5", label: "4:5 · LinkedIn (1080×1350)" },
  { value: "9:16", label: "9:16 · Reels / Shorts" },
  { value: "1:1", label: "1:1 · carré" },
  { value: "16:9", label: "16:9 · YouTube / site" },
];

// Field kinds:
//   text · rich (text with **x** / *x* / | markup) · number
//   lines   one string per line
//   rows    one object per line, cells separated by " | " (cols = keys)
//   tuples  one array per line, cells separated by " | "
// A dotted key ("app.name") reaches into a nested object.
export const SCENE_TYPES = [
  {
    type: "stamps", label: "Mots frappés", bars: 2, energy: "intro", signature: true,
    hint: "Ouverture : un mot par temps, avec séparation de couleurs. ≤ 16 caractères par ligne.",
    fields: [{ key: "words", label: "Mots (un par ligne)", kind: "lines", rich: true }],
  },
  {
    type: "headline", label: "Grand titre", bars: 2, energy: "break",
    hint: "Titre révélé ligne par ligne.",
    fields: [
      { key: "kicker", label: "Surtitre", kind: "text" },
      { key: "lines", label: "Lignes du titre", kind: "lines", rich: true },
      { key: "subtitle", label: "Sous-titre", kind: "rich" },
    ],
  },
  {
    type: "appDemo", label: "Démo d'app en direct", bars: 4, energy: "drop",
    hint: "Pour une app / SaaS / IA : un prompt, l'app se construit puis s'allume.",
    fields: [
      { key: "prompt", label: "Demande tapée", kind: "text" },
      { key: "steps", label: "Étapes cochées (≤ 4)", kind: "lines" },
      { key: "app.url", label: "Adresse de l'app", kind: "text" },
      { key: "app.name", label: "Nom de l'app", kind: "text" },
      { key: "app.greeting", label: "Salutation", kind: "text" },
      { key: "app.stats", label: "Chiffres (emoji | valeur | libellé)", kind: "tuples", cols: 3 },
      { key: "app.rows", label: "Lignes (emoji | nom | détail)", kind: "tuples", cols: 3 },
      { key: "toast", label: "Bandeau final", kind: "text" },
    ],
  },
  {
    type: "showcase", label: "Le site qui défile", bars: 3, energy: "drop",
    hint: "Capture pleine page du site (public/site.png) dans un navigateur en 3D.",
    fields: [
      { key: "caption", label: "Légende", kind: "rich" },
      { key: "url", label: "Adresse affichée", kind: "text" },
      { key: "screenshot", label: "Image (dans public/)", kind: "text", placeholder: "site.png" },
    ],
  },
  {
    type: "sketchToReal", label: "Idée → réalité", bars: 4, energy: "drop",
    hint: "Post-it, croquis au feutre, puis un faisceau révèle la vraie capture du site livré.",
    fields: [
      { key: "idea", label: "L'idée (post-it)", kind: "text" },
      { key: "caption", label: "Légende", kind: "rich" },
      { key: "screenshot", label: "Capture réelle (dans public/)", kind: "text", placeholder: "projects/mon-site.png" },
      { key: "url", label: "Adresse affichée", kind: "text" },
      { key: "badge", label: "Badge (ex. Livré en 1 jour — réel)", kind: "text" },
    ],
  },
  {
    type: "traceToArt", label: "Du tracé au tableau", bars: 4, energy: "drop",
    hint: "Une vraie sortie se dessine sur sa carte, les compteurs montent, puis la carte entre dans le cadre d'un tableau (tracé : scripts/extract_route.py).",
    fields: [
      { key: "caption", label: "Légende", kind: "rich" },
      { key: "caption2", label: "Légende finale (tableau)", kind: "rich" },
      { key: "map", label: "Carte (dans public/)", kind: "text", placeholder: "site/map.png" },
      { key: "trace", label: "Tracé JSON (dans public/)", kind: "text", placeholder: "site/route.json" },
      { key: "stats", label: "Compteurs réels (valeur | libellé)", kind: "tuples", cols: 2 },
      { key: "poster", label: "Photo du tableau (dans public/)", kind: "text", placeholder: "site/poster.png" },
    ],
  },
  {
    type: "squad", label: "L'équipe", bars: 4, energy: "drop",
    hint: "Un membre par temps, le 1er au centre, les autres en couronne ; puis sa bulle (message RÉEL).",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "members", label: "Membres (nom | rôle | image)", kind: "rows", cols: ["name", "role", "image"] },
      { key: "message.text", label: "Message du 1er membre", kind: "text" },
    ],
  },
  {
    type: "speedrun", label: "Chrono des réalisations", bars: 2, energy: "drop", signature: true,
    hint: "Vraies réalisations sur les temps, chacune avec son VRAI délai ; un chronomètre par projet (≤ 5).",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "items", label: "Projets (nom | délai | image)", kind: "rows", cols: ["name", "time", "image"] },
    ],
  },
  {
    type: "wall", label: "Mur de projets", bars: 2, energy: "drop", signature: true,
    hint: "Dézoom sur un mur 3D + grand chiffre. Avec une image, la tuile montre le vrai projet.",
    fields: [
      { key: "big", label: "Grand chiffre", kind: "text" },
      { key: "label", label: "Libellé", kind: "rich" },
      { key: "stats", label: "Chiffres (valeur | libellé)", kind: "tuples", cols: 2 },
      { key: "tiles", label: "Tuiles (nom | image optionnelle)", kind: "rows", cols: ["name", "image"] },
    ],
  },
  {
    type: "counters", label: "Compteurs", bars: 2, energy: "drop", signature: true,
    hint: "Chiffres clés qui roulent comme une machine à sous (≤ 4).",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "items", label: "Chiffres (valeur | libellé)", kind: "tuples", cols: 2 },
    ],
  },
  {
    type: "punchlines", label: "Punchlines", bars: 2, energy: "drop", signature: true,
    hint: "Un bénéfice tous les 2 temps, plein écran. Durée : nombre d'items ÷ 2 mesures.",
    fields: [
      { key: "items", label: "Items (grand | texte)", kind: "rows", cols: ["big", "text"] },
      { key: "marquee", label: "Texte défilant", kind: "text" },
    ],
  },
  {
    type: "steps", label: "Étapes", bars: 2, energy: "break",
    hint: "Parcours en étapes ; tremble vers le drop suivant.",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "steps", label: "Étapes (surtitre | libellé)", kind: "rows", cols: ["kicker", "label"] },
      { key: "footer", label: "Pied", kind: "text" },
      { key: "icon", label: "Icône", kind: "text", placeholder: "🚀" },
    ],
  },
  {
    type: "chat", label: "Avis en discussion", bars: 2, energy: "drop", signature: true,
    hint: "Citations RÉELLES uniquement (≤ 3).",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "channel", label: "Canal", kind: "text", placeholder: "# communauté" },
      { key: "members", label: "Membres", kind: "text" },
      { key: "messages", label: "Messages (nom | rôle | citation)", kind: "rows", cols: ["who", "role", "quote"] },
      { key: "typing", label: "« … est en train d'écrire »", kind: "text" },
    ],
  },
  {
    type: "launch", label: "Dernière demande", bars: 1, energy: "build",
    hint: "Look « prompt d'IA » : produits tech uniquement. Le clic tombe sur le final.",
    fields: [
      { key: "question", label: "Question", kind: "rich" },
      { key: "input", label: "Texte tapé", kind: "text" },
    ],
  },
  {
    type: "finale", label: "Final", bars: 2, energy: "finale", signature: true,
    hint: "Impact, logo, promesse, bouton, adresse.",
    fields: [
      { key: "headline", label: "Promesse", kind: "rich" },
      { key: "cta", label: "Bouton", kind: "text" },
      { key: "url", label: "Adresse", kind: "text" },
      { key: "pills", label: "Pastilles (≤ 3)", kind: "lines" },
    ],
  },
  // --- style « ligne » (storyboard "style": "line") : plan-séquence sobre
  {
    type: "lineNoise", label: "Ligne · Le bruit", bars: 2, energy: "build",
    hint: "Notifications (RÉELLES : douleurs citées par le site) et mots à la mode s'empilent, puis tout est aspiré en un point.",
    fields: [
      { key: "title", label: "Titre", kind: "text" },
      { key: "alerts", label: "Alertes (une par ligne)", kind: "lines" },
      { key: "words", label: "Mots de décor (un par ligne)", kind: "lines" },
    ],
  },
  {
    type: "lineSignal", label: "Ligne · Le signal", bars: 2, energy: "drop",
    hint: "Une phrase, puis des mots posés le long de la ligne sur les temps.",
    fields: [
      { key: "lead", label: "Phrase", kind: "rich" },
      { key: "words", label: "Mots (≤ 4, un par ligne)", kind: "lines" },
    ],
  },
  {
    type: "lineAnalogy", label: "Ligne · L'analogie", bars: 2, energy: "break",
    hint: "« Comme un [mot qui bascule à chaque temps]… » puis la chute et une pastille.",
    fields: [
      { key: "before", label: "Avant le mot", kind: "text", placeholder: "Comme un" },
      { key: "words", label: "Mots qui basculent (un par ligne)", kind: "lines" },
      { key: "after", label: "Chute", kind: "rich" },
      { key: "tag", label: "Pastille", kind: "text" },
    ],
  },
  {
    type: "lineMethod", label: "Ligne · La méthode", bars: 4, energy: "drop",
    hint: "Les étapes en frise sur la ligne ; la caméra descend d'étape en étape.",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "steps", label: "Étapes (titre | détail)", kind: "rows", cols: ["title", "detail"] },
    ],
  },
  {
    type: "lineHumans", label: "Ligne · Les humains", bars: 2, energy: "break",
    hint: "Une phrase avec des visages DANS le texte : [3] insère les 3 visages suivants.",
    fields: [
      { key: "text", label: "Phrase (avec [n])", kind: "rich" },
      { key: "faces", label: "Visages (images, une par ligne)", kind: "lines" },
      { key: "note", label: "Note", kind: "rich" },
    ],
  },
  {
    type: "lineVoices", label: "Ligne · Les voix", bars: 3, energy: "drop",
    hint: "Citations RÉELLES qui partent de la ligne, une par mesure.",
    fields: [{ key: "quotes", label: "Citations (texte | nom | rôle | image)", kind: "rows", cols: ["text", "who", "role", "image"] }],
  },
  {
    type: "lineClose", label: "Ligne · L'arrivée", bars: 2, energy: "finale",
    hint: "La ligne tourne vers le bouton ; un curseur le clique ; logo et adresse.",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "sub", label: "Sous-titre", kind: "text" },
      { key: "cta", label: "Bouton", kind: "text" },
      { key: "url", label: "Adresse", kind: "text" },
      { key: "logo", label: "Logo (dans public/)", kind: "text", placeholder: "brand/logo.png" },
    ],
  },
  // --- style « tableau » (storyboard "style": "board") : canevas infini, caméra qui voyage
  {
    type: "boardDraw", label: "Tableau · Le trait", bars: 2, energy: "intro",
    hint: "Un curseur arrive et écrit un mot à la main.",
    fields: [
      { key: "kicker", label: "Sur-titre (mono)", kind: "text" },
      { key: "word", label: "Mot écrit à la main", kind: "text" },
      { key: "sub", label: "Phrase", kind: "text" },
      { key: "cursor", label: "Nom du curseur", kind: "text", placeholder: "Vous" },
    ],
  },
  {
    type: "boardStickies", label: "Tableau · Les post-its", bars: 2, energy: "drop",
    hint: "Un post-it collé par temps, puis un mot écrit et une étiquette.",
    fields: [
      { key: "items", label: "Post-its (≤ 6, un par ligne)", kind: "lines" },
      { key: "word", label: "Mot écrit à la main", kind: "text" },
      { key: "tag", label: "Étiquette", kind: "text" },
    ],
  },
  {
    type: "boardCollab", label: "Tableau · Ensemble", bars: 2, energy: "drop",
    hint: "3 curseurs rangent 3 notes et les relient par des flèches.",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "notes", label: "Notes (3, une par ligne)", kind: "lines" },
      { key: "cursors", label: "Noms des curseurs (3)", kind: "lines" },
    ],
  },
  {
    type: "boardFlow", label: "Tableau · Le flowchart", bars: 3, energy: "break",
    hint: "Départ → question (losange) → Oui → résultat, puis un mot écrit.",
    fields: [
      { key: "start", label: "Départ", kind: "text" },
      { key: "question", label: "Question", kind: "text" },
      { key: "yes", label: "Branche", kind: "text", placeholder: "Oui" },
      { key: "result", label: "Résultat", kind: "text" },
      { key: "resultSub", label: "Sous le résultat", kind: "text" },
      { key: "word", label: "Mot écrit à la main", kind: "text" },
      { key: "flag", label: "Emoji", kind: "text" },
    ],
  },
  {
    type: "boardPricing", label: "Tableau · Les tarifs", bars: 2, energy: "drop",
    hint: "Les offres en post-its (≤ 3), l'une entourée au feutre.",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "plans", label: "Offres (prix | nom | note)", kind: "rows", cols: ["price", "name", "note"] },
    ],
  },
  {
    type: "boardFinale", label: "Tableau · Le dézoom final", bars: 2, energy: "finale",
    hint: "Dézoom sur tout le tableau, puis la carte d'appel à l'action.",
    fields: [
      { key: "title", label: "Titre", kind: "rich" },
      { key: "cta", label: "Bouton", kind: "text" },
      { key: "note", label: "Mention (mono)", kind: "text" },
      { key: "url", label: "Adresse", kind: "text" },
      { key: "logo", label: "Logo (dans public/)", kind: "text", placeholder: "brand/logo.png" },
    ],
  },
  // --- style « graphique » (storyboard "style": "chart") : portrait / rapport en dataviz, valeurs RÉELLES
  { type: "chartManifesto", label: "Graphique · Le manifeste", bars: 2, energy: "intro", hint: "Lignes tapées façon terminal, deux mots en grand, puis la photo.",
    fields: [{ key: "lines", label: "Lignes tapées", kind: "lines" }, { key: "big", label: "Mots en grand", kind: "lines", rich: true }, { key: "photo", label: "Photo (dans public/)", kind: "text" }, { key: "name", label: "Nom", kind: "text" }, { key: "role", label: "Rôle", kind: "text" }] },
  { type: "chartCurve", label: "Graphique · La courbe", bars: 4, energy: "drop", hint: "Courbe cumulée qui se dessine, compteur, noms accrochés (valeurs réelles).",
    fields: [{ key: "title", label: "Titre", kind: "rich" }, { key: "series", label: "Points (libellé | valeur)", kind: "tuples", cols: 2 }, { key: "marks", label: "Repères (point | nom)", kind: "rows", cols: ["at", "name"] }, { key: "yLabel", label: "Légende", kind: "text" }] },
  { type: "chartHistogram", label: "Graphique · L'histogramme", bars: 2, energy: "drop", hint: "Barres qui poussent, certaines mises en avant, un encadré.",
    fields: [{ key: "title", label: "Titre", kind: "rich" }, { key: "bins", label: "Barres (libellé | nombre)", kind: "tuples", cols: 2 }, { key: "callout", label: "Encadré", kind: "text" }, { key: "badge", label: "Mention", kind: "text" }] },
  { type: "chartWall", label: "Graphique · Le mur", bars: 2, energy: "drop", hint: "Mosaïque de vraies captures qui s'allument en vague (≤ 16).",
    fields: [{ key: "title", label: "Titre", kind: "rich" }, { key: "images", label: "Images (une par ligne)", kind: "lines" }] },
  { type: "chartSpotlight", label: "Graphique · Le projet phare", bars: 2, energy: "break", hint: "Capture dans un cadre, titre, pastilles de faits réels.",
    fields: [{ key: "kicker", label: "Sur-titre", kind: "text" }, { key: "title", label: "Titre", kind: "rich" }, { key: "sub", label: "Phrase", kind: "text" }, { key: "image", label: "Capture (dans public/)", kind: "text" }, { key: "url", label: "Adresse", kind: "text" }, { key: "chips", label: "Pastilles", kind: "lines" }] },
  { type: "chartTransmit", label: "Graphique · Photo + indicateurs", bars: 2, energy: "drop", hint: "Grande photo, titre, 3 indicateurs qui défilent.",
    fields: [{ key: "photo", label: "Photo", kind: "text" }, { key: "title", label: "Titre", kind: "rich" }, { key: "kpis", label: "Indicateurs (valeur | libellé)", kind: "tuples", cols: 2 }] },
  { type: "chartVoices", label: "Graphique · Les voix", bars: 2, energy: "break", hint: "Photo en fond, citations RÉELLES en cartes (≤ 2).",
    fields: [{ key: "photo", label: "Photo", kind: "text" }, { key: "quotes", label: "Citations (texte | nom | rôle)", kind: "rows", cols: ["text", "who", "role"] }] },
  { type: "chartFinale", label: "Graphique · Le final", bars: 2, energy: "finale", hint: "Photo ronde, nom, phrase en dégradé, bouton, adresse.",
    fields: [{ key: "photo", label: "Photo", kind: "text" }, { key: "name", label: "Nom", kind: "text" }, { key: "role", label: "Rôle", kind: "text" }, { key: "line", label: "Phrase", kind: "text" }, { key: "cta", label: "Bouton", kind: "text" }, { key: "url", label: "Adresse", kind: "text" }] },
];

export const sceneType = (type) => SCENE_TYPES.find((t) => t.type === type) || null;

// ------------------------------------------------------------- props access

export function getPath(obj, key) {
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, key, value) {
  const parts = key.split(".");
  let o = obj;
  for (const k of parts.slice(0, -1)) {
    if (typeof o[k] !== "object" || o[k] === null || Array.isArray(o[k])) o[k] = {};
    o = o[k];
  }
  const last = parts[parts.length - 1];
  if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) delete o[last];
  else o[last] = value;
  return obj;
}

const splitCells = (line) => line.split("|").map((c) => c.trim());

/** Props value → text shown in the form. */
export function toText(field, value) {
  if (value == null) return "";
  switch (field.kind) {
    case "lines":
      return (Array.isArray(value) ? value : [value]).join("\n");
    case "tuples":
      return (value || []).map((row) => (Array.isArray(row) ? row : [row]).join(" | ")).join("\n");
    case "rows":
      // A bare string (older storyboards: wall tiles) fills the first column.
      return (value || []).map((row) => (typeof row === "string" ? row : field.cols.map((c) => row?.[c] ?? "").join(" | "))).join("\n");
    default:
      return String(value);
  }
}

/** Form text → props value. */
export function fromText(field, text) {
  const raw = String(text ?? "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  switch (field.kind) {
    case "lines":
      return lines;
    case "tuples":
      return lines.map((l) => {
        const cells = splitCells(l).slice(0, field.cols);
        while (cells.length < field.cols) cells.push("");
        return cells;
      });
    case "rows":
      return lines.map((l) => {
        const cells = splitCells(l);
        const row = {};
        field.cols.forEach((c, i) => {
          // The last column takes the rest: a quote may contain « | ».
          const v = i === field.cols.length - 1 ? cells.slice(i).join(" | ") : cells[i];
          if (v) row[c] = v;
        });
        return row;
      });
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    default:
      return raw.trim();
  }
}

// ---------------------------------------------------------------- storyboard

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
export const slugify = (s) =>
  String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "promo";

/** Leave a storyboard the engine can render; unknown scene types are dropped. */
export function normaliseStoryboard(raw = {}) {
  const moods = MOODS.map((m) => m.value);
  const formats = (Array.isArray(raw.formats) ? raw.formats : ["4:5"])
    .filter((f) => PROMO_FORMATS.some((p) => p.value === f));
  const music = raw.music || {};
  const mode = music.mode === "file" && music.file ? "file" : "generate";
  const out = {
    title: String(raw.title || "").slice(0, 120),
    url: String(raw.url || "").slice(0, 300),
    formats: formats.length ? [...new Set(formats)] : ["4:5"],
    music: {
      mode,
      mood: moods.includes(music.mood) ? music.mood : "electro",
      bpm: clampInt(music.bpm, 60, 180, 120),
      ...(mode === "file" ? { file: String(music.file), offset: Math.max(0, Number(music.offset) || 0) } : {}),
      // The seed makes each promo's music its own (compose.py), and re-renders stable.
      ...(Number.isInteger(music.seed) && music.seed >= 0 ? { seed: music.seed } : {}),
    },
    invented: (Array.isArray(raw.invented) ? raw.invented : []).map(String).filter(Boolean),
    scenes: [],
  };
  // Texte du post LinkedIn (sinon, package.py en tire un brouillon). LinkedIn
  // coupe à 3 000 caractères.
  if (typeof raw.post === "string" && raw.post.trim()) out.post = raw.post.trim().slice(0, 3000);
  // Style de mise en scène : "line" = plan-séquence sobre (fond papier, une ligne continue).
  if (["line", "board", "chart"].includes(raw.style)) out.style = raw.style;
  // Voix off (scripts/voice_mix.py) : prise + placement des phrases, gardés tels quels.
  if (raw.voice && typeof raw.voice === "object" && typeof raw.voice.source === "string") {
    out.voice = {
      source: raw.voice.source,
      clips: (Array.isArray(raw.voice.clips) ? raw.voice.clips : [])
        .map((c) => ({ start: Number(c?.start), end: Number(c?.end), at: Number(c?.at) }))
        .filter((c) => [c.start, c.end, c.at].every(Number.isFinite) && c.end > c.start),
      ...(Number.isFinite(Number(raw.voice.gain)) ? { gain: Number(raw.voice.gain) } : {}),
    };
  }
  for (const sc of Array.isArray(raw.scenes) ? raw.scenes : []) {
    const def = sceneType(sc?.type);
    if (!def) continue;
    const scene = {
      type: def.type,
      bars: clampInt(sc.bars, 1, 8, def.bars),
      energy: ENERGIES.some((e) => e.value === sc.energy) ? sc.energy : def.energy,
      props: sc.props && typeof sc.props === "object" && !Array.isArray(sc.props) ? sc.props : {},
    };
    if (sc.prompt) scene.prompt = String(sc.prompt).slice(0, 80);
    out.scenes.push(scene);
  }
  return out;
}

export function newScene(type) {
  const def = sceneType(type);
  if (!def) throw new Error(`type de scène inconnu : ${type}`);
  return { type: def.type, bars: def.bars, energy: def.energy, props: {} };
}

/** A minimal storyboard to start from — the skill (Claude) usually writes the real one. */
export function starterStoryboard(title, url) {
  const host = String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return normaliseStoryboard({
    title, url, formats: ["4:5"], music: { mode: "generate", mood: "electro", bpm: 120 },
    scenes: [
      { type: "stamps", bars: 2, energy: "intro", props: { words: [title || "Ton projet", "En *ligne*."] } },
      { type: "counters", bars: 2, energy: "drop", props: { title: "En **chiffres**", items: [] } },
      { type: "finale", bars: 2, energy: "finale", props: { headline: title || "", cta: "Découvrir →", url: host } },
    ],
  });
}

/** Seconds per scene and in total (+ the reverb tail the engine adds). */
export function promoTiming(sb) {
  const bar = 240 / (sb.music?.bpm || 120);
  let t = 0;
  const scenes = (sb.scenes || []).map((sc) => {
    const start = t;
    t += sc.bars * bar;
    return { start, duration: sc.bars * bar };
  });
  return { bar, scenes, total: t + 0.75 * bar };
}

const plain = (s) => String(s || "").replace(/\*/g, "");

/** Things worth a look before rendering — never blocking. */
export function storyboardWarnings(sb) {
  const w = [];
  const scenes = sb.scenes || [];
  if (!scenes.length) return ["Aucune scène."];
  if (scenes[0].energy !== "intro") w.push("La première scène devrait être en énergie « Intro ».");
  const last = scenes[scenes.length - 1];
  if (last.type !== "finale" || last.energy !== "finale") w.push("La dernière scène devrait être le Final (énergie « Final »).");
  scenes.forEach((sc, i) => {
    const n = i + 1;
    const next = scenes[i + 1];
    if ((sc.energy === "break" || sc.energy === "build") && next && !["drop", "finale"].includes(next.energy)) {
      w.push(`Scène ${n} : une ${sc.energy === "break" ? "pause" : "montée"} doit déboucher sur un drop ou le final.`);
    }
    if (sc.type === "stamps") {
      for (const word of sc.props.words || []) {
        const longest = Math.max(...plain(word).split("|").map((l) => l.length));
        if (longest > 16) w.push(`Scène ${n} : « ${plain(word)} » dépasse 16 caractères par ligne (coupe avec |).`);
      }
    }
    if (sc.type === "punchlines") {
      const items = (sc.props.items || []).length;
      if (items && Math.abs(items / 2 - sc.bars) >= 1) w.push(`Scène ${n} : ${items} punchlines → ${Math.ceil(items / 2)} mesure(s) conseillée(s).`);
    }
    if (sc.type === "chat" && (sc.props.messages || []).length > 3) w.push(`Scène ${n} : plus de 3 messages ne tiennent pas en 4:5.`);
    if (sc.type === "counters" && !(sc.props.items || []).length) w.push(`Scène ${n} : aucun chiffre renseigné.`);
  });
  const total = promoTiming(sb).total;
  if (total > 45) w.push(`Durée ${Math.round(total)} s : au-delà de 45 s, l'attention chute sur LinkedIn.`);
  return w;
}

// ------------------------------------------------------------------- brand

/**
 * The brand.json a promo reads, from a studio brand kit.
 * `fonts` = state.fonts (imported files), `labels` = system font value → label.
 * Returns the JSON and the files to copy from media/ into public/brand/.
 */
export function promoBrand(brand, { fonts = [], labels = {}, logo = null } = {}) {
  const copies = [];
  const out = { name: brand.name, studioBrandId: brand.id, colors: { ...brand.colors }, fonts: {} };
  for (const role of ["title", "body"]) {
    const v = brand.fonts?.[role] || "system";
    if (v.startsWith("file:")) {
      const file = v.slice(5);
      const ext = file.slice(file.lastIndexOf("."));
      const name = fonts.find((f) => f.file === file)?.name || role;
      copies.push({ from: file, to: `${role}${ext}` });
      out.fonts[role] = { family: name, file: `brand/${role}${ext}` };
    } else {
      out.fonts[role] = { family: v === "system" ? "SF Pro Display" : labels[v] || v };
    }
  }
  if (brand.logo) {
    out.logo = "brand/logo.png";
    out.logoTile = Boolean(logo?.tile);
    out.logoAspect = logo?.aspect || 1;
  }
  return { json: out, copies };
}
