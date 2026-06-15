# Aloud · „Pontos PDF" exact-compile szolgáltatás

Valódi **TeX Live** mikroszolgáltatás (= Overleaf-szintű, **byte-azonos** kimenet) az Aloud
„Pontos PDF" gombjához. A frontend **marad GitHub Pages-en**; ez a szerver csak a fordítást futtatja.

## Szerződés (a `tex-compile.js` `compileExact`-jéhez illesztve)

```
POST <endpoint>            Content-Type: application/json
  { "mainFile": "Doctoral_Thesis_v18_3_HU.tex",
    "files": [ {"path":"main.tex","text":"..."},
               {"path":"Hivatkozott_Kepek/x.png","b64":"<base64>"},
               {"path":"refs.bbl","text":"..."} ] }
→ 200 application/pdf   (a lefordított bájtok)
→ 422 text/plain        (compile hiba + log-farok)
GET /health → 200 "ok"
```
CORS: `Access-Control-Allow-Origin: *` (GitHub Pages-ről hívható).

## Bekötés a frontendbe

A böngészőkonzolban / egy kis `<script>`-ben az appban:
```js
window.ALOUD_TEX_EXACT_ENDPOINT = "https://aloud-tex.fly.dev/compile";
```
Ezután a Compiled pane **„Pontos PDF"** gombja ezt hívja → byte-azonos 219 oldalas PDF.

## Lokális futtatás / teszt
```bash
# helyi TeX Live-val (latexmk vagy pdflatex):
TEX_ENGINE=pdflatex PORT=8090 node server.js
# teszt:
curl -s -X POST localhost:8090/compile -H 'Content-Type: application/json' \
  -d '{"mainFile":"m.tex","files":[{"path":"m.tex","text":"\\documentclass{article}\\begin{document}Hi\\end{document}"}]}' \
  -o out.pdf && file out.pdf
```

## Deploy

### Fly.io (ajánlott — scale-to-zero, ~ingyenes idle-ben)
```bash
fly launch --no-deploy      # vagy: fly apps create aloud-tex
fly deploy                  # a Dockerfile-t építi (texlive/texlive ~5 GB → első build lassú)
# endpoint: https://<app>.fly.dev/compile
```
`fly.toml`: `auto_stop_machines=true`, `min_machines_running=0` → idle-ben nem fizetsz; első kérés cold-start (~mp).

### Google Cloud Run
```bash
gcloud run deploy aloud-tex --source . --port 8080 \
  --memory 2Gi --timeout 300 --allow-unauthenticated
```

### Render / Railway
Új Web Service a repo `exact-compile-server/` mappájából, Docker környezet, port 8080.

## Megjegyzések
- **Kép méret:** a `texlive/texlive` teljes (~5 GB) → byte-azonos Overleaf-kimenet garantált. Kisebb image:
  válts `scheme-medium` bázisra és `tlmgr install`-old a dolgozat csomagjait (preamble-ből / a projekt `.fls`-éből).
- **Memória:** 200+ oldalas tikz dolgozathoz 2 GB ajánlott (OOM esetén 4 GB).
- **Biztonság:** `-no-shell-escape` (nincs `\write18`), `openin_any=p`/`openout_any=p` (paranoid fájlhozzáférés),
  konténer-izoláció, body- és időkorlát. Saját/megbízható használatra szánt; publikus expozícióhoz tegyél elé
  hitelesítést (pl. egy token-fejléc ellenőrzése a `server.js`-ben) és rate-limitet.
- **Engine:** alapból `latexmk` (saját menet- és bibtex-kezelés, mint Overleaf). `TEX_ENGINE=pdflatex` → 3 menet, bibtex nélkül (kész `.bbl` kell).
