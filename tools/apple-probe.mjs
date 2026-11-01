// Probe Apple's iTunes Search API for every film on one ladder and report matches as annotations.
import fs from "node:fs";
const ladder = process.argv[2] || "bond";
const L = JSON.parse(fs.readFileSync(`data/${ladder}.json`, "utf8"));
const films = [];
for (const c of [...L.core, ...(L.beyond || [])]) {
  films.push({ t: c.t, y: c.y, role: "core" });
  for (const s of c.seq || []) films.push({ t: s.t, y: s.y, role: "seq" });
  for (const b of c.br || []) films.push({ t: b.t, y: b.y, role: "side" });
}
const n = x => (x || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "").replace(/^the/, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
let hits = 0;
for (const f of films) {
  let line = `MISS ${f.t} (${f.y})`;
  try {
    const u = `https://itunes.apple.com/search?${new URLSearchParams({ term: f.t, entity: "movie", country: "gb", limit: "25" })}`;
    const r = await fetch(u); const j = await r.json();
    const yr = m => +(m.releaseDate || "0").slice(0, 4);
    const res = j.results || [];
    const m = res.find(m => n(m.trackName) === n(f.t) && Math.abs(yr(m) - f.y) <= 1)
      || res.find(m => n(m.trackName).startsWith(n(f.t)) && Math.abs(yr(m) - f.y) <= 1);
    if (m) {
      hits++;
      let loc = "";
      if (out.length < 3) { const h = await fetch(m.trackViewUrl, { redirect: "manual" }); loc = " -> " + (h.headers.get("location") || h.status); }
      line = `HIT ${f.t} (${f.y}) = "${m.trackName}" (${yr(m)}) ${m.trackViewUrl}${loc}`;
    }
  } catch (e) { line = `ERR ${f.t} (${f.y}) ${e.message}`; }
  out.push(line); console.log(line);
  await sleep(3200);
}
console.log(`::notice title=Apple probe ${ladder}: ${hits}/${films.length}::${out.join("%0A")}`);
