// Probe CheapCharts for UK Apple TV prices. Not used by the site build.
const UA = { "User-Agent": "boilthefrog-probe/1.0 (https://boilthefrog.github.io)" };
const lines = [];
const show = async (label, url, extra = {}) => {
  try { const r = await fetch(url, { headers: { ...UA, ...extra } }); const t = await r.text(); lines.push(`${label} => ${r.status} ${t.replace(/\s+/g, " ").slice(0, 700)}`); return t; }
  catch (e) { lines.push(`${label} => ERR ${e.message}`); return ""; }
};
// 1. iTunes ids for a few Bond films from Wikidata (P6398 iTunes movie ID)
const tmdb = { Goldfinger: 658, "Casino Royale": 36557, "Dr. No": 646, Skyfall: 37724, "The Ipcress File": 15247 };
const q = `SELECT ?tmdb ?it WHERE { VALUES ?tmdb { ${Object.values(tmdb).map(x => `"${x}"`).join(" ")} } ?i wdt:P4947 ?tmdb. OPTIONAL { ?i wdt:P6398 ?it } }`;
const wd = await (await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: UA })).json();
const it = {}; for (const b of wd.results.bindings) if (b.it) it[b.tmdb.value] = b.it.value;
lines.push("wikidata itunes ids: " + JSON.stringify(it));
for (const [name, id] of Object.entries(tmdb)) {
  if (!it[id]) continue;
  await show(`DetailData gb ${name}`, `https://buster.cheapcharts.de/v1/DetailData.php?store=itunes&country=gb&itemType=movies&idInStore=${it[id]}`, { Referer: "https://www.cheapcharts.info/" });
  await new Promise(r => setTimeout(r, 800));
}
// 2. the public AI API, guessing common paths
for (const p of ["", "search?term=goldfinger&country=gb", "search?q=goldfinger&country=gb", "search.php?term=goldfinger&country=gb&itemType=all", "openapi.json", "docs"]) {
  await show(`gptapi /${p}`, `https://buster.cheapcharts.de/v1/gptapi/${p}`);
}
console.log("::notice title=CheapCharts probe::" + lines.join("%0A"));
