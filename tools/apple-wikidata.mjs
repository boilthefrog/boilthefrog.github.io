// Probe: TMDB id -> Wikidata -> Apple TV movie id, for one ladder.
import fs from "node:fs";
const ladder = process.argv[2] || "bond";
const KEY = process.env.TMDB_API_KEY;
const L = JSON.parse(fs.readFileSync(`data/${ladder}.json`, "utf8"));
const films = [];
for (const c of [...L.core, ...(L.beyond || [])]) {
  films.push({ t: c.t, y: c.y, tmdb: c.tmdb, q: c.q });
  for (const s of c.seq || []) films.push({ t: s.t, y: s.y });
  for (const b of c.br || []) films.push({ t: b.t, y: b.y, tmdb: b.tmdb, q: b.q });
}
const auth = KEY.length > 40 ? { headers: { Authorization: `Bearer ${KEY}` } } : null;
async function tmdb(p, params = {}) {
  const u = new URL("https://api.themoviedb.org/3" + p);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!auth) u.searchParams.set("api_key", KEY);
  return (await fetch(u, auth || {})).json();
}
const n = x => (x || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "").replace(/^the/, "");
for (const f of films) {
  if (f.tmdb) continue;
  const q = f.q || f.t, yr = m => +(m.release_date || "0").slice(0, 4);
  const r = await tmdb("/search/movie", { query: q, year: f.y });
  const res = r.results || [];
  const m = res.find(m => Math.abs(yr(m) - f.y) <= 1 && (n(m.title) === n(q) || n(m.original_title) === n(q))) || res[0];
  f.tmdb = m && m.id;
}
// find the property by label
const sp = async q => (await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { "User-Agent": "boilthefrog-probe/1.0 (github.com/boilthefrog)" } })).json();
const props = await sp(`SELECT ?p ?l WHERE { ?p a wikibase:Property; rdfs:label ?l. FILTER(LANG(?l)="en" && CONTAINS(LCASE(?l),"apple tv")) }`);
const plist = props.results.bindings.map(b => b.p.value.split("/").pop() + " " + b.l.value);
const movieProp = (props.results.bindings.find(b => /apple tv movie id/i.test(b.l.value)) || {}).p?.value.split("/").pop();
const ids = films.map(f => f.tmdb).filter(Boolean);
const res = await sp(`SELECT ?tmdb ?apple WHERE { VALUES ?tmdb { ${ids.map(i => `"${i}"`).join(" ")} } ?item wdt:P4947 ?tmdb. OPTIONAL { ?item wdt:${movieProp} ?apple } }`);
const map = {};
for (const b of res.results.bindings) if (b.apple) map[b.tmdb.value] = b.apple.value;
const lines = films.map(f => `${map[f.tmdb] ? "HIT" : "MISS"} ${f.t} (${f.y}) tmdb ${f.tmdb} ${map[f.tmdb] ? "https://tv.apple.com/gb/movie/" + map[f.tmdb] : ""}`);
const hits = lines.filter(l => l.startsWith("HIT")).length;
console.log(`::notice title=Wikidata Apple ${ladder}: ${hits}/${films.length}::props: ${plist.join("; ")}%0A${lines.join("%0A")}`);
