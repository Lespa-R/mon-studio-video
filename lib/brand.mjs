// Brand kits ("chartes graphiques"): a named set of colours, two fonts and a
// logo. A project points at one; every effect of that project reads it.
//
// Effects never copy the brand's values. A colour param may hold a token such
// as "brand:primary", which compiles to `var(--brand-primary)`; compose.mjs
// declares those variables on #root. Change the kit and every linked colour
// and every title follows — without touching a single effect.
//
// Pure functions only.

export const COLOR_ROLES = [
  { key: "primary", label: "Principale" },
  { key: "secondary", label: "Secondaire" },
  { key: "text", label: "Texte" },
  { key: "surface", label: "Fond" },
];

// Fonts macOS ships with. Headless Chrome renders through CoreText, so they
// work in the MP4 exactly as in the preview, with nothing to download.
export const SYSTEM_FONTS = [
  { value: "system", label: "Système (SF Pro)", css: `-apple-system, "SF Pro Display", system-ui, sans-serif` },
  { value: "Helvetica Neue", label: "Helvetica Neue" },
  { value: "Avenir Next", label: "Avenir Next" },
  { value: "Futura", label: "Futura" },
  { value: "Gill Sans", label: "Gill Sans" },
  { value: "Optima", label: "Optima" },
  { value: "Georgia", label: "Georgia", serif: true },
  { value: "Baskerville", label: "Baskerville", serif: true },
  { value: "Didot", label: "Didot", serif: true },
  { value: "Palatino", label: "Palatino", serif: true },
  { value: "American Typewriter", label: "American Typewriter", serif: true },
  { value: "Menlo", label: "Menlo", mono: true },
  { value: "Impact", label: "Impact" },
];

// Imported through POST /api/assets. Anything else is ignored, so a brand can
// never smuggle markup into a composition.
export const FONT_FILE = /^font_[a-f0-9]{8,32}\.(woff2|woff|ttf|otf)$/;
export const LOGO_FILE = /^asset_[a-f0-9]{8,32}\.(png|jpe?g|webp)$/;
const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_BRAND = Object.freeze({
  id: null,
  name: "Studio (par défaut)",
  colors: Object.freeze({ primary: "#4f8cff", secondary: "#6d28d9", text: "#ffffff", surface: "#080e1a" }),
  fonts: Object.freeze({ title: "system", body: "system" }),
  logo: "",
});

const cleanFont = (v, fallback) => {
  const value = String(v ?? "");
  if (value.startsWith("file:") && FONT_FILE.test(value.slice(5))) return value;
  return SYSTEM_FONTS.some((f) => f.value === value) ? value : fallback;
};

// Whatever arrives (an old file, a PATCH body), leave a well-formed brand.
export function normaliseBrand(raw = {}) {
  const colors = {};
  for (const { key } of COLOR_ROLES) {
    const v = raw.colors?.[key];
    colors[key] = HEX.test(String(v)) ? String(v).toLowerCase() : DEFAULT_BRAND.colors[key];
  }
  return {
    id: raw.id ?? null,
    name: String(raw.name || "Ma charte").slice(0, 80),
    colors,
    fonts: {
      title: cleanFont(raw.fonts?.title, DEFAULT_BRAND.fonts.title),
      body: cleanFont(raw.fonts?.body, DEFAULT_BRAND.fonts.body),
    },
    logo: LOGO_FILE.test(String(raw.logo || "")) ? raw.logo : "",
  };
}

// ------------------------------------------------------------- colours

const TOKEN = /^brand:(primary|secondary|text|surface)$/;

export const isBrandToken = (v) => TOKEN.test(String(v));

// A colour param as CSS: a token becomes the brand variable, a hex stays
// itself, anything else falls back (and the fallback may be a token too).
export function paint(value, fallback = "brand:text") {
  const v = String(value ?? "");
  if (TOKEN.test(v)) return `var(--brand-${v.slice(6)})`;
  if (HEX.test(v)) return v;
  return fallback === value ? "#ffffff" : paint(fallback, "#ffffff");
}

// The same colour at some opacity. color-mix keeps it working on a variable.
export const paintAlpha = (value, alpha, fallback) =>
  `color-mix(in srgb, ${paint(value, fallback)} ${Math.round(alpha * 100)}%, transparent)`;

// A token's actual colour, for the UI swatches.
export function resolveColor(value, brand = DEFAULT_BRAND) {
  const v = String(value ?? "");
  if (TOKEN.test(v)) return brand.colors[v.slice(6)];
  return HEX.test(v) ? v : null;
}

// --------------------------------------------------------------- fonts

const familyName = (role) => `brand-${role}`;

function fontStack(font, role) {
  if (font.startsWith("file:")) return `"${familyName(role)}", -apple-system, system-ui, sans-serif`;
  const known = SYSTEM_FONTS.find((f) => f.value === font) || SYSTEM_FONTS[0];
  if (known.css) return known.css;
  const generic = known.mono ? "monospace" : known.serif ? "serif" : "sans-serif";
  return `"${known.value}", ${generic}`;
}

const FORMATS = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

// Everything a composition needs to carry the brand: the variables on #root,
// @font-face rules for imported fonts, and the families the page must have
// loaded before it measures any text.
export function brandCss(input) {
  const brand = normaliseBrand(input || DEFAULT_BRAND);
  const faces = [];
  const toLoad = [];
  for (const role of ["title", "body"]) {
    const font = brand.fonts[role];
    if (!font.startsWith("file:")) continue;
    const file = font.slice(5);
    const ext = file.split(".").pop();
    faces.push(`      @font-face { font-family: "${familyName(role)}"; src: url("media/${file}") format("${FORMATS[ext]}"); font-display: block; }`);
    toLoad.push(familyName(role));
  }
  const vars = [
    ...COLOR_ROLES.map(({ key }) => `--brand-${key}: ${brand.colors[key]};`),
    `--font-title: ${fontStack(brand.fonts.title, "title")};`,
    `--font-body: ${fontStack(brand.fonts.body, "body")};`,
  ];
  return {
    faces: faces.join("\n"),
    vars: vars.join(" "),
    toLoad,
  };
}
