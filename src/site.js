/* Boil the Frog: shared progress, ladder filters, thermometer, Letterboxd export, pot page. */
(function () {
  const KEY = "btf-v1";
  let S = {};
  try { S = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { S = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const set = (id, on) => { if (on) S[id] = 1; else delete S[id]; save(); };

  function sync() {
    document.querySelectorAll(".watch[data-id]").forEach(b => {
      const on = !!S[b.dataset.id];
      b.setAttribute("aria-pressed", on);
      const wl = b.querySelector(".wl"); if (wl) wl.textContent = on ? "Watched" : "Mark watched";
      const t = b.closest(".tape"); if (t) t.classList.toggle("done", on);
    });
    document.querySelectorAll(".blist input[data-id]").forEach(i => {
      const on = !!S[i.dataset.id]; i.checked = on; i.closest("li").classList.toggle("got", on);
    });
    thermo();
  }

  document.addEventListener("click", e => {
    const b = e.target.closest(".watch[data-id]");
    if (b) { set(b.dataset.id, !S[b.dataset.id]); sync(); }
  });
  document.addEventListener("change", e => {
    const i = e.target.closest(".blist input[data-id]");
    if (i) { set(i.dataset.id, i.checked); sync(); }
  });

  /* thermometer (ladder pages) */
  const L = window.LADDER;
  const ticks = document.getElementById("ticks");
  if (ticks) for (let d = 20; d <= 100; d += 10) { const i = document.createElement("i"); i.style.bottom = ((d - 20) / 80 * 100) + "%"; ticks.appendChild(i); }
  function words(t) { return t < 30 ? "Lukewarm. Frog suspects nothing" : t < 50 ? "Warming up. Frog is relaxed" : t < 70 ? "Hot bath. Frog has questions" : t < 90 ? "Simmering. Too late to hop out" : t < 100 ? "Rolling boil" : "Cooked. Welcome to " + ((L && L.title) || "the genre").toLowerCase(); }
  function thermo() {
    if (!L || !document.getElementById("merc")) return;
    const core = L.core.filter(id => S[id]).length, pct = core / L.core.length, t = Math.round(20 + 80 * pct);
    const $ = id => document.getElementById(id);
    $("merc").style.height = (pct * 100) + "%";
    $("frog").style.bottom = (pct * 100) + "%";
    $("tdeg").textContent = t + "°"; $("tword").textContent = words(t);
    $("mdeg").textContent = t + "°C"; $("mfill").style.width = (pct * 100) + "%";
    $("mword").textContent = core + " of " + L.core.length + " watched";
    $("mouth").setAttribute("d", t < 50 ? "M20 29 Q30 35 40 29" : t < 80 ? "M21 31 L39 31" : "M21 33 Q30 26 39 33");
  }

  /* flavour filters */
  const fbox = document.getElementById("filters");
  if (fbox) {
    const fc = document.getElementById("fcount");
    fbox.addEventListener("click", e => {
      const c = e.target.closest(".chip"); if (!c) return;
      const k = c.dataset.k || null;
      fbox.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === c)));
      document.body.classList.toggle("filtering", !!k);
      let n = 0;
      document.querySelectorAll(".tape").forEach(t => {
        const own = k && (t.dataset.tags || "").includes(k);
        t.classList.toggle("hit", !!own); if (own) n++;
        let sub = 0;
        t.querySelectorAll(".blist li").forEach(li => { const h = k && (li.dataset.tags || "").includes(k); li.classList.toggle("hit", !!h); if (h) { sub++; n++; } });
        const d = t.querySelector("details");
        if (d) { if (k && sub) { d.open = true; t.classList.add("hit"); } else if (k) d.open = false; }
      });
      fc.textContent = k ? n + " " + c.textContent.toLowerCase() + " film" + (n === 1 ? "" : "s") : "";
    });
  }

  /* Letterboxd export of unwatched films */
  const ex = document.getElementById("export-unwatched");
  if (ex && L) ex.addEventListener("click", () => {
    const rows = L.films.filter(f => !S[f.id]);
    const csv = "tmdbID,Title,Year,Review\n" + rows.map(r => [r.tmdb || "", r.t, r.y, r.note].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n") + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "boil-the-frog-" + L.id + "-not-watched.csv";
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* reset */
  const rb = document.getElementById("reset");
  if (rb) { let armed = null; rb.addEventListener("click", () => {
    if (!armed) { rb.textContent = "Tap again to wipe all ticks"; armed = setTimeout(() => { rb.textContent = "Reset progress"; armed = null; }, 3500); return; }
    clearTimeout(armed); armed = null; S = {}; save(); rb.textContent = "Reset progress"; sync();
  }); }

  /* pot page */
  const pw = document.getElementById("potwrap");
  if (pw && window.POT) {
    pw.innerHTML = window.POT.map(l => {
      const core = l.core.filter(c => S[c.id]).length, all = l.all.filter(id => S[id]).length;
      return '<div class="member"><div class="kicker">Membership card</div><h2>' + l.title + '</h2>' +
        '<p class="potstats">' + core + ' of ' + l.core.length + ' core · ' + (all - core) + ' side quests and sequels</p>' +
        '<div class="stamps">' + l.core.map((c, i) => '<a class="stamp-slot' + (S[c.id] ? " on" : "") + '" href="../films/' + c.id + '/" title="' + c.t.replace(/"/g, "&quot;") + '">' + (S[c.id] ? c.t : String(i + 1)) + '</a>').join("") + '</div>' +
        '<p><a class="btn" href="../' + l.id + '/">Back to the ladder</a></p></div>';
    }).join("");
  }

  sync();
})();
