// Boil the Frog static site builder. No dependencies: `node build.mjs`.
// If TMDB_API_KEY is set (v4 read access token or v3 key), films are enriched with
// posters, synopsis, runtime, director and UK certificate from TMDB.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, "dist");
const CACHE = path.join(ROOT, ".cache", "tmdb.json");
const KEY = process.env.TMDB_API_KEY || "";
const IMG = "https://image.tmdb.org/t/p/";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = (t, y) => `${t}-${y}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const write = (p, s) => { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

/* ---------- load ladders ---------- */
const ladders = fs.readdirSync(path.join(ROOT, "data")).filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8")))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

// Flatten every film into a registry keyed by slug, recording where it sits.
const films = new Map();
function reg(o, ladder, role, extra = {}) {
  const id = slug(o.t, o.y);
  const f = films.get(id) || { id, t: o.t, y: o.y, q: o.q, tmdb: o.tmdb, places: [] };
  Object.assign(f, { note: f.note || o.note || o.b, warn: f.warn || o.warn || o.w, tags: f.tags || o.tags, junk: f.junk || o.junk });
  if (o.heat && !f.heat) { f.heat = o.heat; f.heatLadder = ladder.id; }
  f.places.push({ ladder: ladder.id, ladderTitle: ladder.title, role, ...extra });
  films.set(id, f);
  return id;
}
for (const L of ladders) {
  for (const c of L.core) {
    c.id = reg(c, L, "core", { n: c.n });
    for (const q of c.seq || []) q.id = reg(q, L, "sequel", { of: c.id, star: q.star });
    for (const b of c.br) {
      b.id = reg(b, L, "side", { of: c.id });
      for (const q of b.seq || []) q.id = reg(q, L, "sequel", { of: b.id, star: q.star });
    }
  }
  for (const b of L.beyond) {
    b.id = reg(b, L, "beyond");
    for (const q of b.seq || []) q.id = reg(q, L, "sequel", { of: b.id, star: q.star });
  }
}

/* ---------- TMDB enrichment ---------- */
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch {}
async function tmdb(p, params = {}) {
  const u = new URL("https://api.themoviedb.org/3" + p);
  const headers = { accept: "application/json" };
  if (KEY.length > 40) headers.authorization = "Bearer " + KEY; else u.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { headers });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`TMDB ${r.status} ${p}`);
    return r.json();
  }
  throw new Error("TMDB rate limited");
}
async function findId(f) {
  if (f.tmdb) return f.tmdb;
  const q = (f.q || f.t).replace(/[–—]/g, "-");
  const n = x => (x || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "").replace(/^the/, "");
  const yr = m => +(m.release_date || "0").slice(0, 4);
  let fallback = null;
  // Exact title within a year wins, from any search; otherwise the most-voted near-year hit.
  for (const p of [{ query: q, year: f.y }, { query: q, primary_release_year: f.y }, { query: q }]) {
    const r = await tmdb("/search/movie", p);
    const res = r.results || [];
    const exact = res.find(m => Math.abs(yr(m) - f.y) <= 1 && (n(m.title) === n(q) || n(m.original_title) === n(q)));
    if (exact) return exact.id;
    const near = res.filter(m => Math.abs(yr(m) - f.y) <= 1).sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))[0];
    if (near && (!fallback || (near.vote_count || 0) > (fallback.vote_count || 0))) fallback = near;
  }
  return fallback ? fallback.id : null;
}
async function enrich(f) {
  if (cache[f.id]?.v === 3) return cache[f.id];
  const id = await findId(f);
  if (!id) return (cache[f.id] = { v: 3, missing: true });
  const m = await tmdb(`/movie/${id}`, { append_to_response: "release_dates,credits,external_ids" });
  const gb = (m.release_dates?.results || []).find(r => r.iso_3166_1 === "GB");
  const cert = (gb?.release_dates || []).map(d => d.certification).find(Boolean) || "";
  const dirs = (m.credits?.crew || []).filter(c => c.job === "Director").map(c => c.name);
  const cast = (m.credits?.cast || []).slice(0, 4).map(c => c.name);
  return (cache[f.id] = { v: 3, title: m.title, year: +(m.release_date || "0").slice(0, 4), tmdb: id, imdb: m.external_ids?.imdb_id || m.imdb_id || "", poster: m.poster_path || "", overview: m.overview || "", runtime: m.runtime || 0, original: m.original_title, lang: m.original_language, cert, dirs, cast });
}
if (KEY) {
  const list = [...films.values()];
  let i = 0, miss = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < list.length) {
      const f = list[i++];
      try { f.m = await enrich(f); if (f.m.missing) miss.push(f.id); } catch (e) { console.warn("TMDB failed", f.id, e.message); }
    }
  }));
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  const norm = x => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const checks = list.filter(f => f.m && !f.m.missing && norm(f.m.title) !== norm(f.t)).map(f => `${f.id} -> "${f.m.title}" (${f.m.year}) tmdb ${f.m.tmdb}`);
  checks.forEach(c => console.log("CHECK " + c));
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=TMDB title check::${[`missing: ${miss.join(", ")}`, ...checks].join("%0A")}`);
  console.log(`TMDB: ${list.length - miss.length}/${list.length} matched` + (miss.length ? `; no match: ${miss.join(", ")}` : ""));
} else {
  for (const f of films.values()) f.m = cache[f.id];
  console.log("TMDB_API_KEY not set: building without posters and synopses.");
}
const M = id => films.get(id)?.m || {};
const poster = (id, size = "w185") => M(id).poster ? IMG + size + M(id).poster : "";

/* ---------- layout ---------- */
const CSS = fs.readFileSync(path.join(ROOT, "src", "site.css"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "src", "site.js"), "utf8");
const VER = (await import("node:crypto")).createHash("md5").update(CSS + JS).digest("hex").slice(0, 8);
fs.mkdirSync(OUT, { recursive: true });
write("assets/site.css", CSS);
write("assets/site.js", JS);
// Approved TMDB logo (blue short). Fetched at build time; falls back to TMDB's own URL.
const TMDB_LOGO_URL = "https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg";
let TMDB_LOGO = TMDB_LOGO_URL;
try { const r = await fetch(TMDB_LOGO_URL); if (r.ok) { write("assets/tmdb.svg", await r.text()); TMDB_LOGO = "assets/tmdb.svg"; } } catch {}
const tmdbLogo = (root, cls) => `<a class="${cls}" href="https://www.themoviedb.org/"><img src="${TMDB_LOGO.startsWith("http") ? TMDB_LOGO : root + TMDB_LOGO}" alt="TMDB"></a>`;
write(".nojekyll", "");

const FROG = `<svg viewBox="0 0 60 40" aria-hidden="true"><ellipse cx="30" cy="28" rx="24" ry="12" fill="#5d9b3a"/><circle cx="17" cy="13" r="9" fill="#5d9b3a"/><circle cx="43" cy="13" r="9" fill="#5d9b3a"/><circle cx="17" cy="13" r="4.5" fill="#fff"/><circle cx="43" cy="13" r="4.5" fill="#fff"/><circle cx="17" cy="14" r="2.2" fill="#17110d"/><circle cx="43" cy="14" r="2.2" fill="#17110d"/></svg>`;
const page = ({ title, body, root = "", desc = "", extraHead = "" }) => `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc || "Film ladders for people who think they don't like a genre. Start lukewarm, finish at the deep end.")}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800;900&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}assets/site.css?v=${VER}">
${extraHead}
</head>
<body>
<nav class="topnav"><div class="topnav-in"><a class="brand" href="${root}">${FROG}Boil the Frog</a><div class="navlinks">${ladders.map(l => `<a href="${root}${l.id}/">${esc(l.title)}</a>`).join("")}<a href="${root}pot/">Your pot</a><a href="${root}about/">About</a></div></div></nav>
${body}
<footer><div class="foot-in" style="max-width:980px;margin:0 auto"><div>
<p class="small">Boil the Frog: film ladders for people who think they don't like a genre. Ticks are saved in this browser only.</p>
<p class="credit">${tmdbLogo(root, "tmdb-logo")} Film data and posters from <a href="https://www.themoviedb.org/">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
</div></div></footer>
<script src="${root}assets/site.js?v=${VER}"></script>
</body></html>`;

/* ---------- ladder page ---------- */
const tagChips = (L, t) => [...(t || "")].map(k => `<span class="tag">${esc(L.tags[k])}</span>`).join("");
function item(L, o, isSeq, root) {
  const sub = (o.seq || []).length ? `<ul class="blist sub">${o.seq.map(q => item(L, q, true, root)).join("")}</ul>` : "";
  return `<li data-tags="${esc(o.tags || "")}" data-id="${o.id}" class="${isSeq ? "sq" : ""}"><input type="checkbox" id="cb-${o.id}" data-id="${o.id}" aria-label="Watched ${esc(o.t)}"><label for="cb-${o.id}">${isSeq ? '<span class="sqtag">Sequel</span>' : ""}${o.junk ? '<span class="junk">Junk food</span>' : ""}<span class="bt"><a href="${root}films/${o.id}/">${esc(o.t)}</a>${o.star ? ' <span class="star">★ Worth it</span>' : ""}</span><span class="by">${o.y}</span><span class="bn">${esc(o.note)}</span>${o.warn ? `<span class="bw">${esc(o.warn)}</span>` : ""}</label>${sub}</li>`;
}
function card(L, c, no, beyond, root) {
  const brs = c.br || [], sq = c.seq || [];
  for (const q of sq) q.tags = q.tags || c.tags;
  for (const b of brs) for (const q of b.seq || []) q.tags = q.tags || b.tags;
  const parts = [brs.length ? `${brs.length} side quest${brs.length > 1 ? "s" : ""}` : "", sq.length ? `${sq.length} sequel${sq.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
  const prev = brs.map(b => esc(b.t)).concat(sq.map(q => esc(q.t) + " (sequel)")).join(" · ");
  const list = (sq.length ? `<p class="lh">Sequels</p><ul class="blist seqs">${sq.map(q => item(L, q, true, root)).join("")}</ul>` : "") + (brs.length ? `<p class="lh">Side quests</p><ul class="blist">${brs.map(b => item(L, b, false, root)).join("")}</ul>` : "");
  const p = poster(c.id);
  return `<article class="tape" data-tags="${esc(c.tags)}" data-id="${c.id}" ${beyond ? "" : 'data-core="1"'}>
<div class="spine"><span class="no">${no}</span><span class="reel" aria-hidden="true"></span></div>
<div class="label">
${p ? `<a class="poster" href="${root}films/${c.id}/" tabindex="-1" aria-hidden="true"><img src="${p}" alt="" loading="lazy" width="92" height="138"></a>` : ""}
<div class="trow"><h3><a href="${root}films/${c.id}/">${esc(c.t)}</a><span class="yr">${c.y}</span></h3>
<button class="watch" type="button" aria-pressed="false" data-id="${c.id}"><span class="box" aria-hidden="true"></span><span class="wl">Mark watched</span></button></div>
<p class="blurb">${esc(c.b)}</p>
${c.w ? `<p class="warn">${esc(c.w)}</p>` : ""}
<div class="tags">${tagChips(L, c.tags)}</div>
${parts ? `<details class="branches"><summary><span class="sumlab"><span class="arrow" aria-hidden="true">▸</span>${beyond ? "" : "Liked it? "}${parts}</span><span class="preview">${prev}</span></summary>${list}</details>` : ""}
<div class="stamp" aria-hidden="true">${beyond ? "SURVIVED" : "WATCHED"}</div>
</div></article>`;
}
function ladderPage(L) {
  const root = "../";
  let lo = 0;
  const secs = L.levels.map((lv, i) => {
    const next = L.levels[i + 1] ? L.levels[i + 1].bg : lv.bg;
    let cards = "";
    if (lv.beyond) cards = L.beyond.map(b => card(L, b, "✕", true, root)).join("");
    else { cards = L.core.filter(c => c.n > lo && c.n <= lv.upto).map(c => card(L, c, String(c.n).padStart(2, "0"), false, root)).join(""); lo = lv.upto; }
    return `<section class="level${lv.beyond ? " beyond" : ""}" id="level-${i + 1}" style="--bg:${lv.bg};--bg2:${next};--fg:${lv.fg}"><div class="level-in"><div class="lhead"><div class="temp">${lv.t}<sup>°C</sup></div><h2 class="lname">${lv.beyond ? "Beyond the final boss: " : `Level ${i + 1}: `}${esc(lv.name)}</h2><p class="lnote">${esc(lv.note)}</p></div><div class="shelf">${cards}</div></div></section>`;
  }).join("");
  const chips = `<span class="lab">Hunt by flavour</span><button class="chip" type="button" data-k="" aria-pressed="true">Everything</button>` + Object.entries(L.tags).map(([k, v]) => `<button class="chip" type="button" data-k="${k}" aria-pressed="false">${esc(v)}</button>`).join("") + `<span class="fcount" id="fcount"></span>`;
  const all = [...films.values()].filter(f => f.places.some(p => p.ladder === L.id));
  const exportData = all.map(f => ({ id: f.id, t: f.t, y: f.y, tmdb: M(f.id).tmdb || null, note: f.note || "", core: f.places.some(p => p.role === "core") }));
  const total = all.length;
  const body = `
<header class="hero">
<div class="kicker">The ${esc(L.title)} ladder</div>
<h1>Boil <span class="wob">the</span> Frog</h1>
<p class="lede">${L.core.length} films, each a few degrees hotter than the last, plus ${total - L.core.length} side quests and sequels. ${esc(L.tagline)}</p>
<ul class="rules">
<li><b>Climb in order</b>Each core film turns the heat up one notch.</li>
<li><b>Liked one? Branch off</b>Every film has side quests at the same heat, plus sequels: the ones marked ★ Worth it are as good as the original. Junk food is cult trash, enjoyed responsibly.</li>
<li><b>One a week</b>The core 30 takes about seven months. Ticks are saved in this browser.</li>
</ul>
</header>
<div class="exports"><b>Send to Letterboxd</b>
<a class="btn" href="letterboxd-core.csv" download>Core 30</a>
<a class="btn" href="letterboxd-all.csv" download>Everything</a>
<button class="btn" type="button" id="export-unwatched">Not watched yet</button>
<a class="btn" href="https://letterboxd.com/about/importing/" rel="noopener">How to import</a></div>
<nav class="filters" aria-label="Filter by flavour"><div class="filters-in" id="filters">${chips}</div></nav>
<main id="pot">${secs}</main>
<aside class="thermo" aria-live="polite"><div class="tube"><div class="ticks" id="ticks"></div><div class="merc" id="merc"></div>
<svg class="frog" id="frog" viewBox="0 0 60 40" aria-hidden="true"><ellipse cx="30" cy="28" rx="24" ry="12" fill="#5d9b3a" stroke="#17110d" stroke-width="2.5"/><circle cx="17" cy="13" r="9" fill="#5d9b3a" stroke="#17110d" stroke-width="2.5"/><circle cx="43" cy="13" r="9" fill="#5d9b3a" stroke="#17110d" stroke-width="2.5"/><circle cx="17" cy="13" r="4.5" fill="#fff" stroke="#17110d" stroke-width="1.5"/><circle cx="43" cy="13" r="4.5" fill="#fff" stroke="#17110d" stroke-width="1.5"/><circle id="pupL" cx="17" cy="14" r="2.2" fill="#17110d"/><circle id="pupR" cx="43" cy="14" r="2.2" fill="#17110d"/><path id="mouth" d="M20 29 Q30 35 40 29" fill="none" stroke="#17110d" stroke-width="2.5" stroke-linecap="round"/></svg>
</div><div class="bulb"></div><div class="treadout"><b id="tdeg">20°</b><span id="tword">Lukewarm</span></div></aside>
<div class="mbar" aria-live="polite"><b id="mdeg">20°C</b><div class="mtrack"><div class="mfill" id="mfill" style="width:0"></div></div><span id="mword">0 of 30 watched</span></div>
<div class="foot-in" style="max-width:980px;margin:0 auto;padding:30px 20px"><button class="btn" id="reset" type="button">Reset progress</button></div>
<script>window.LADDER=${JSON.stringify({ id: L.id, title: L.title, core: L.core.map(c => c.id), films: exportData })};</script>`;
  write(`${L.id}/index.html`, page({ title: `${L.title} | Boil the Frog`, body, root, desc: `The ${L.title} ladder: ${L.tagline}` }));
  // Letterboxd CSVs
  const csv = rows => "tmdbID,Title,Year,Review\n" + rows.map(r => [r.tmdb || "", r.t, r.y, r.note].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
  const coreRows = L.core.map(c => exportData.find(e => e.id === c.id));
  write(`${L.id}/letterboxd-core.csv`, csv(coreRows));
  write(`${L.id}/letterboxd-all.csv`, csv(exportData));
}

/* ---------- film pages ---------- */
const DEFAULT_HEAT = [["gore", "Gore"], ["dread", "Dread"], ["jumps", "Jump scares"], ["weird", "Weirdness"]];
function filmPage(f) {
  const root = "../../", m = f.m || {};
  const HL = ladders.find(l => l.id === (f.heatLadder || f.places[0].ladder));
  const HEAT = HL.heatKeys || DEFAULT_HEAT;
  const where = f.places.map(p => {
    const of = p.of ? films.get(p.of) : null;
    if (p.role === "core") return `Step ${p.n} of 30 on the <a href="${root}${p.ladder}/">${esc(p.ladderTitle)} ladder</a>.`;
    if (p.role === "beyond") return `Beyond the final boss on the <a href="${root}${p.ladder}/">${esc(p.ladderTitle)} ladder</a>.`;
    if (p.role === "sequel") return `${p.star ? '<span class="star">★ Worth it</span> ' : ""}Sequel spur off <a href="${root}films/${of.id}/">${esc(of.t)}</a> on the <a href="${root}${p.ladder}/">${esc(p.ladderTitle)} ladder</a>.`;
    return `${f.junk ? "Junk-food " : ""}Side quest off <a href="${root}films/${of.id}/">${esc(of.t)}</a> on the <a href="${root}${p.ladder}/">${esc(p.ladderTitle)} ladder</a>.`;
  }).join(" ");
  let coreObj = null;
  for (const l of ladders) coreObj = coreObj || l.core.find(c => c.id === f.id) || l.beyond.find(b => b.id === f.id);
  const sides = coreObj?.br || [], seqs = coreObj?.seq || [];
  const pp = poster(f.id, "w342");
  const facts = [f.y, m.runtime ? `${m.runtime} min` : "", m.dirs?.length ? "Dir. " + m.dirs.join(", ") : ""].filter(Boolean).map(esc).join(" · ");
  const lb = m.tmdb ? `https://letterboxd.com/tmdb/${m.tmdb}` : `https://letterboxd.com/search/${encodeURIComponent(f.t + " " + f.y)}/`;
  const body = `<main class="film">
<div>${pp ? `<img class="fposter" src="${pp}" alt="${esc(f.t)} poster" width="342" height="513">` : `<div class="fposter blank">${esc(f.t)}</div>`}</div>
<div>
<div class="kicker">${f.places.some(p => p.role === "core") ? "Core film" : f.places.some(p => p.role === "beyond") ? "Past the final boss" : f.junk ? "Junk food" : "Side quest"}</div>
<h1>${esc(f.t)}</h1>
<div class="facts"><span>${facts}</span>${m.cert ? `<span class="cert" title="UK certificate">${esc(m.cert)}</span>` : ""}${f.junk ? '<span class="junk">Junk food</span>' : ""}</div>
<p class="where">${where}</p>
<p class="ourtake">${esc(f.note || "")}</p>
${f.warn ? `<p class="warn">${esc(f.warn)}</p>` : ""}
${f.heat ? `<div class="heat" aria-label="Heat scores out of 5">${HEAT.map(([k, n]) => `<span>${n}</span><i style="--v:${f.heat[k] * 20}%" title="${f.heat[k]} out of 5"></i>`).join("")}</div>` : ""}
${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ""}
${m.cast?.length ? `<p class="small">With ${esc(m.cast.join(", "))}</p>` : ""}
<div class="links"><button class="watch btn" type="button" aria-pressed="false" data-id="${f.id}"><span class="box" aria-hidden="true"></span><span class="wl">Mark watched</span></button>
<a class="btn" href="${lb}" rel="noopener">Letterboxd</a>${m.tmdb ? `<a class="btn" href="https://www.themoviedb.org/movie/${m.tmdb}" rel="noopener">TMDB</a>` : ""}${m.imdb ? `<a class="btn" href="https://www.imdb.com/title/${m.imdb}/" rel="noopener">IMDb</a>` : ""}</div>
${seqs.length ? `<section class="fsec"><h2>Sequels</h2><ul>${seqs.map(q => `<li><a href="${root}films/${q.id}/">${esc(q.t)}</a> (${q.y})${q.star ? ' <span class="star">★ Worth it</span>' : ""}: ${esc(q.note)}</li>`).join("")}</ul></section>` : ""}
${sides.length ? `<section class="fsec"><h2>Liked it? Side quests</h2><ul>${sides.map(b => `<li>${b.junk ? '<span class="junk">Junk food</span>' : ""}<a href="${root}films/${b.id}/">${esc(b.t)}</a> (${b.y}): ${esc(b.note)}</li>`).join("")}</ul></section>` : ""}
</div></main>`;
  write(`films/${f.id}/index.html`, page({ title: `${f.t} (${f.y}) | Boil the Frog`, body, root, desc: f.note }));
}

/* ---------- home, pot, about ---------- */
function home() {
  const body = `<header class="hero">
<div class="kicker">Film ladders for people who think they don't like a genre</div>
<h1>Boil <span class="wob">the</span> Frog</h1>
<p class="lede">Start lukewarm. Each film is a few degrees hotter than the last. By the time you reach the deep end, you won't have noticed the water got hot.</p>
<ul class="rules">
<li><b>Pick a ladder</b>Thirty core films, gateway to deep end.</li>
<li><b>Branch off</b>Liked a film? Side quests at the same heat.</li>
<li><b>Track it</b>Tick films off, watch the thermometer rise, export to Letterboxd.</li>
</ul></header>
<div class="home-ladders">
${ladders.map(L => `<a class="ladder-card" href="${L.id}/"><div class="kicker">Ladder</div><h2>${esc(L.title)}</h2><div class="heatbar" aria-hidden="true"></div><p>${esc(L.tagline)}</p><p><b>${L.core[0].t} → ${L.core[L.core.length - 1].t}</b></p></a>`).join("")}
${[["World cinema", "Marcello, come here!", "La Dolce Vita"]].map(([t, q, f]) => `<div class="ladder-card soon"><div class="kicker">Coming later</div><h2>${t}</h2><div class="heatbar" aria-hidden="true"></div><blockquote class="quote">“${esc(q)}”<cite>${esc(f)}</cite></blockquote></div>`).join("")}
</div>`;
  write("index.html", page({ title: "Boil the Frog", body }));
}
function pot() {
  const idx = ladders.map(L => ({ id: L.id, title: L.title, core: L.core.map(c => ({ id: c.id, t: c.t })), all: [...films.values()].filter(f => f.places.some(p => p.ladder === L.id)).map(f => f.id) }));
  const body = `<header class="hero"><div class="kicker">Your progress</div><h1>Your pot</h1><p class="lede">Every film you've ticked, on this device. One stamp per core film.</p></header>
<div class="card-wrap" id="potwrap"></div>
<script>window.POT=${JSON.stringify(idx)};</script>`;
  write("pot/index.html", page({ title: "Your pot | Boil the Frog", body, root: "../" }));
}
function about() {
  const body = `<header class="hero"><div class="kicker">About</div><h1>The method</h1></header>
<div class="prose">
<p>The idea comes from the boiling frog: put it in warm water, raise the heat slowly, and it never notices. Each ladder starts with films someone who "doesn't like" the genre will enjoy anyway, and adds one new kind of difficulty per step: tension, gore, subtitles, slowness, strangeness.</p>
<p><b>Core films</b> are the essential route. <b>Side quests</b> are similar films at the same heat, for when someone loves a step. <b>Sequels</b> worth the detour are starred. <b>Junk food</b> marks cult trash: fun, not great.</p>
<p><b>Heat scores</b> rate each core film out of 5 on four measures that suit its ladder: on Horror, gore, dread, jump scares and weirdness; elsewhere, violence, intensity, how old-school it feels and how much work it asks of you. They're hand-judged guides, not data, and they'll be refined.</p>
<p><b>Letterboxd:</b> each ladder can be downloaded as a CSV and imported into a Letterboxd list (Lists → New list → Import). Films are matched by their TMDB ID.</p>
${tmdbLogo("../", "tmdb-logo big")}<p class="credit">Film data and posters are from <a href="https://www.themoviedb.org/">The Movie Database (TMDB)</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
</div>`;
  write("about/index.html", page({ title: "About | Boil the Frog", body, root: "../" }));
}

ladders.forEach(ladderPage);
[...films.values()].forEach(filmPage);
home(); pot(); about();
console.log(`Built ${films.size} film pages, ${ladders.length} ladder(s) into dist/`);
