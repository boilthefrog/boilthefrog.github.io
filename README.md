# Boil the Frog

Film ladders for people who think they don't like a genre. Start lukewarm; each film is a few degrees hotter than the last.

## How it works

- `data/*.json`: one file per ladder (core films, side quests, sequels, junk food, heat scores, warnings).
- `build.mjs`: builds the static site into `dist/`. No dependencies: `node build.mjs`.
- `src/site.css`, `src/site.js`: design and interactivity (ticking films, filters, thermometer, Letterboxd export).
- `.github/workflows/pages.yml`: builds and deploys to GitHub Pages on every push to `main`.

## TMDB

Set the repository secret `TMDB_API_KEY` (the TMDB API Read Access Token) and the build adds posters, synopses, runtimes, directors and UK certificates. Without it the site still builds, just without that data.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Editing a ladder

Edit `data/horror.json` and push. Each film needs a title (`t`) and year (`y`); add `q` if TMDB needs a different search title (for example `"q": "Hausu"`).
