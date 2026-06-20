# SCImago (Scopus) journal-quartile data for the Literature search

The Research → Literature search tags each result with its **Scopus quartile (Q1–Q4)** and offers a
quartile filter. That needs the SCImago Journal Rank list as a compact `scimago-scopus.json`
(ISSN → quartile) at the app root. SCImago is Cloudflare-gated, so download it once in a browser:

1. open **https://www.scimagojr.com/journalrank.php**
2. scroll to the bottom of the table → **Download data** (CSV, semicolon-delimited, e.g. `scimagojr 2024.csv`)
3. from this folder:
   ```bash
   python3 build_scimago.py 'scimagojr 2024.csv' > ../../scimago-scopus.json
   git add ../../scimago-scopus.json && git commit -m "data: refresh SCImago Scopus quartiles"
   ```

Until then `scimago-scopus.json` is `{}` and the search simply omits the Scopus tag/filter (the
OpenAlex `✓ Indexed` tag + the other metrics still work). Re-run yearly to refresh.
