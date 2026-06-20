#!/usr/bin/env python3
"""Build scimago-scopus.json (ISSN -> Scopus best quartile 1..4) from a SCImago Journal Rank CSV.

SCImago is Cloudflare-gated, so the CSV must be downloaded once in a browser (it's one click):
  1. open  https://www.scimagojr.com/journalrank.php
  2. bottom of the table → "Download data"  (or use the year URL ?out=xls)
     → you get e.g.  'scimagojr 2024.csv'   (semicolon-delimited)
Then, from this folder:
  python3 build_scimago.py 'scimagojr 2024.csv' > ../../scimago-scopus.json
  git add ../../scimago-scopus.json && commit

The Research → Literature search picks it up automatically (a 'Scopus Q1' tag + a quartile filter).
Re-run yearly to refresh. Output is a compact {issn8: quartile} map (~0.5-1 MB, gzipped by Pages).
"""
import sys, csv, json, re


def norm(issn):
    s = re.sub(r"[^0-9Xx]", "", issn or "").upper()
    return s if len(s) == 8 else None


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: build_scimago.py <scimagojr YYYY.csv>  > scimago-scopus.json")
    out = {}
    with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
        rd = csv.DictReader(f, delimiter=";")
        for row in rd:
            q = (row.get("SJR Best Quartile") or "").strip()
            if q not in ("Q1", "Q2", "Q3", "Q4"):
                continue
            quart = int(q[1])
            for raw in re.split(r"[,\s]+", row.get("Issn") or row.get("ISSN") or ""):
                n = norm(raw)
                if n and (n not in out or quart < out[n]):   # keep the best (lowest) quartile
                    out[n] = quart
    json.dump(out, sys.stdout, separators=(",", ":"))
    sys.stderr.write("wrote %d ISSN->quartile entries\n" % len(out))


if __name__ == "__main__":
    main()
