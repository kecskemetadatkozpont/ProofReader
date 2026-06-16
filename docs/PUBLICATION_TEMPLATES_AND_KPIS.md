# Publication Templates & KPI System for Aloud

> Research and recommendation document for shipping curated LaTeX **Sample Projects** plus an automated **KPI system** that tracks (a) format compliance from manuscript source + PDF and (b) journal-selection bibliometrics.
> **Scope:** venues indexed by Web of Science (WoS Core Collection: SCIE/SSCI/AHCI/ESCI + CPCI) and/or Scopus.
> **Audience:** AI/ML, computer-vision, sensors, and out-of-distribution-detection researchers.

**Status:** research / proposal. **Last reviewed:** 2026-06.
**Critical caveat (read before using any number):** every bibliometric value in this document is a **point-in-time snapshot** drawn from publisher pages and aggregators, cross-checked against authoritative sources (Clarivate JCR, Scopus Source List, Scimago JR). They drift at every annual release and **must be stored as user-editable reference data**, never hard-coded as authoritative. Aggregator sites (Resurchify, journalimpact.org, journalsearches.com) frequently publish *predictive* or *Scopus-derived* impact scores mislabeled as the JCR Impact Factor — these are explicitly flagged below and must not be used as the JIF.

---

## 1. Executive Summary

Aloud's users publish across a small number of dominant LaTeX **document-class families**, not hundreds of per-journal templates. A handful of publisher "umbrella" classes — `IEEEtran`, `elsarticle`, `sn-jnl`, `llncs`, `mdpi`, `acmart` — cover the overwhelming majority of WoS/Scopus-indexed venues this audience targets. Shipping ~8 curated **Sample Projects** keyed to those families (plus a generic `article` carrier for arXiv/NeurIPS/ICML/ICLR/AAAI and a `Blank`) covers essentially all of the indexed output of AI/ML/CV/sensors/OOD researchers.

The KPI system should be built in **three tiers**:

1. **Manuscript/format KPIs (the core, fully automatic):** computed deterministically from the LaTeX source, the compiled PDF, and the `.log`/`.aux`/`.bbl` auxiliary files — page/word/abstract/keyword counts, structural completeness, reference integrity, layout-overflow detection, and per-family format rules (e.g. MDPI 200-word abstract cap, Elsevier highlights 3–5 bullets ≤85 chars, IEEE 2–5 index terms). These need **no external data** and align directly with Aloud's read-aloud proofreading mission.
2. **Journal/bibliometric KPIs (editable reference data per template):** JIF, JCI, CiteScore, SJR, SNIP, quartile+category, APC/OA model, indexing status. A subset (CiteScore, SJR, SNIP, quartile via Scimago, DOAJ APC) is freely auto-syncable by ISSN; JCR-derived metrics (JIF, JCI, Eigenfactor) require a Clarivate subscription and are stored as editable, dated reference data otherwise.
3. **Submission-lifecycle KPIs (mostly manual + derived):** a state machine (drafting → under-review → revision → accepted/rejected/published) with an append-only event log from which durations, revision-round counts, staleness flags, co-author sign-off, and response-to-reviewers completeness are derived.

**Design principles that recur throughout:**

- **Never present an unverified number as authoritative.** Every bibliometric field carries `value`, `asOfYear`, `source`, `confidence`, and a `userVerified` flag, and is editable in-app.
- **Suppress checks that don't apply.** Page-limit checks are meaningless for no-limit venues (IEEE Access, Elsevier, MDPI) — surface the word-count KPI instead.
- **Category is mandatory alongside any quartile.** "Q1" is meaningless without its WoS/Scopus subject category; a journal can be Q1 in one category and Q2 in another (e.g. Remote Sensing is Q1 in *Geosciences, Multidisciplinary* but Q2 in *Imaging Science & Photographic Technology*).
- **Separate JIF from Scopus impact-score fields** in the data model so aggregator contamination (e.g. Information Fusion's Scopus-derived "22.65" vs. JCR 15.5) cannot leak across.

---

## 2. Recommended SHIP LIST (~8 templates, ranked)

Ranked by **WoS/Scopus coverage × relevance** to AI/ML/CV/sensors/OOD authors. Every family below is an umbrella class spanning many indexed venues via a single document class plus options. The generic `Blank` and the existing demo `Sample` are always retained.

| # | id | Name | Publisher | Document class | WoS / Scopus coverage | Primary venues | Why ship |
|---|----|------|-----------|----------------|------------------------|----------------|----------|
| 1 | `ieee-ieeetran` | IEEEtran (Transactions / Journals / Conferences) + IEEE Access (`ieeeaccess.cls`) | IEEE | `IEEEtran` (`[journal]`, `[conference]`, `[technote]`); IEEE Access uses `ieeeaccess.cls` | WoS **SCIE + CPCI** + Scopus; widest high-impact AI/ML/CV/sensors coverage | TPAMI, TIP, TNNLS, IEEE Sensors Journal, T-ITS, TAI, IEEE Access; IEEE/CVF CVPR/ICCV/ECCV (conference mode) | Single most valuable family for this audience: one class + three modes unlocks nearly all IEEE Transactions, the flagship sensors journal, the mega-journal Access, and the CVF computer-vision venues where OOD/sensors work lands. |
| 2 | `elsevier-elsarticle` | elsarticle (Elsevier journal article) | Elsevier | `elsarticle` (options `review`, `1p`, `3p`, `5p`, `twocolumn`, `longmktitle`) | WoS **SCIE/SSCI** + Scopus across Elsevier's full portfolio | Pattern Recognition, Neurocomputing, Expert Systems with Applications, Knowledge-Based Systems, CVIU, Information Fusion, Sensors and Actuators A/B | One class spans the entire Elsevier portfolio incl. the top AI/CV/fusion journals. The `review/1p/3p/5p` option matrix + mandatory Highlights are excellent format-KPI test cases. |
| 3 | `springer-sn-jnl` | sn-jnl (Springer Nature unified) | Springer Nature | `sn-jnl` with a reference-style option: `sn-basic`, `sn-nature`, `sn-mathphys-num/-ay`, `sn-aps`, `sn-vancouver-num/-ay`, `sn-apa`, `sn-chicago` | WoS **SCIE/SSCI** + Scopus across Springer Nature incl. Nature Portfolio | IJCV, Machine Learning, Neural Computing and Applications, Machine Vision and Applications, Applied Intelligence, Scientific Reports | Single class, switchable reference style spans most Springer Nature journals an AI/ML/CV author uses. The option-driven ref style is ideal for the format-compliance engine. Supersedes the legacy `svjour3`. |
| 4 | `springer-llncs` | llncs (Lecture Notes in Computer Science proceedings) | Springer Nature (LNCS/LNAI/CCIS) | `llncs` (current v2.24, Jan 2024); `splncs04.bst` | WoS **CPCI** + Scopus; dominant class for indexed CS/AI **conference** proceedings | ECCV (LNCS volumes), MICCAI, ECML-PKDD, ACCV, ICANN, many CV/ML workshops | Covers the conference side this audience cares about; pairs with IEEEtran-conference and acmart-sigconf to reach almost all indexed CS proceedings. Page-limit-per-CfP is a clean "length is venue-specific" KPI demo. |
| 5 | `mdpi` | MDPI article (`mdpi.cls`, flagship **Sensors**) | MDPI | `mdpi` with `journal=<name>` option (e.g. `journal=sensors`); needs bundled `Definitions/` folder | WoS **SCIE/ESCI** + Scopus; gold-OA mega-publisher | **Sensors**, Remote Sensing, Electronics, Applied Sciences, MAKE, AI, Information, Algorithms | Directly central to the sensors/applied-ML segment. The ~200-word abstract cap, journal-as-class-option, and mandatory Data Availability / Author Contributions statements are concrete, easily checkable rules. Ship **Sensors** as the flagship MDPI Sample Project. |
| 6 | `generic-article` (+ ML-conf `.sty` drop-ins) | Generic article / arXiv / NeurIPS·ICML·ICLR·AAAI camera-ready | LaTeX Project + per-conference kits | `article`, extended with `neurips_20xx.sty`, `icml20xx.sty`, `iclr20xx.sty`, `aaai.sty` | Not itself indexed, but the carrier for **arXiv** and PMLR / NeurIPS Proceedings (**Scopus-indexed**, partly WoS CPCI) | arXiv preprints; NeurIPS, ICML, ICLR, AAAI, IJCAI camera-ready; theses; small ESCI/Scopus journals lacking a bespoke class | Essential safety net: the core AI/ML-conference output (NeurIPS/ICML/ICLR/AAAI) sits on `article` + a venue `.sty` and is reached by none of the publisher classes above. Ship a clean `article` project plus the four main ML-conference style drop-ins. |
| 7 | `acm-acmart` | acmart (ACM journals + proceedings) | ACM | `acmart` (`sigconf`, `acmsmall`/`acmlarge`, `sigplan`, `manuscript`, `review`, `anonymous`) | WoS **CPCI** + ESCI/SCIE (some journals) + Scopus | ACM MM, KDD, SIGIR, WWW/The Web Conf, ACM TIST, ACM Computing Surveys (CSUR), CHI, IUI, TOMM | High for the data-mining / multimedia / IR / HCI-adjacent ML venues. CCS-concepts + ACM Reference Format + TAPS-cleanliness + double-blind anonymization are rich automated-compliance targets. |
| 8 | `aps-revtex4-2` | REVTeX 4.2 (APS / AIP physics & instrumentation) | APS + AIP/AAPM/SOR substyles | `revtex4-2` (`[aps]` + `[prl]…[prx]`/`[prapplied]`; `[aip]` + `[jap]`/`[apl]`/`[rsi]`) | WoS **SCIE** + Scopus | Phys. Rev. Applied, J. Applied Physics, Applied Physics Letters, Review of Scientific Instruments, PRL, PRX | Niche but non-trivial where ML/sensors overlaps applied physics, photonics and instrumentation. One class covers two large physics publishers; **PRL's hard ~3750-word / ~4-page cap** is a clean length-compliance KPI demo. |
| — | `blank` | Blank Project | — | `article` (minimal preamble) | n/a | any | Always-present generic starting point with no venue assumptions. |
| — | `sample` | Demo Sample (existing) | — | (as currently shipped) | n/a | demo/onboarding | Keep the existing in-app demo Sample Project for onboarding. |

**Lower-priority candidates considered and deferred** (ship later as demand warrants; both are journal-parameterised so their KPI rules vary per journal): **Wiley NJD** (`WileyNJD-v2.cls` — International Journal of Intelligent Systems, Expert Systems, IET Computer Vision, Journal of Field Robotics) and **Taylor & Francis** (`interact` class + `tfnlm.bst`/APA — International Journal of Remote Sensing, JETAI, Connection Science). Both are legitimate but reach a smaller share of this audience's indexed output than the eight above.

*Sources for class/option facts:* CTAN `ieeetran`, `elsarticle`, `revtex`; Springer Nature LaTeX author support / Overleaf `sn-jnl` template (option list `sn-basic … sn-chicago` confirmed); Springer "Information for LNCS Authors" (`llncs` v2.24, `splncs04.bst`); MDPI "Preparing Manuscripts in LaTeX"; ACM "Primary Article Template" / `acmart`; APS REVTeX home + CTAN `auguide4-2.pdf`.

---

## 3. Per-Template Format Constraints → Auto-Checks

Each family declares a constraint set the app converts into deterministic checks. **All limits below are shippable, user-overridable defaults**; the authoritative limit is always the target venue's current author guide. Family is detected from the first non-comment `\documentclass[opts]{class}` line.

### 3.1 IEEEtran / IEEE Access (`ieee-ieeetran`)
- **Columns/layout:** two-column, 10 pt Times final typeset; `[conference]` vs `[journal]` vs `[technote]` via class option. Validate `twocolumn,10pt` + correct mode.
- **Abstract:** single self-contained paragraph, ~**150–250 words**; **no** math, citations, references, or abbreviations in abstract (IEEE Access explicit).
- **Index Terms (keywords):** `\begin{IEEEkeywords}…\end{IEEEkeywords}`, **2–5** terms; empty block is a fail.
- **References:** `IEEEtran.bst`, numbered `[n]` (Vancouver-like). Validate `\bibliographystyle{IEEEtran}` / equivalent + numbered `\cite`.
- **Page limit:** *set per venue, not by the class.* IEEE **Transactions** enforce hard limits (representative regular-paper default ~12 two-column pages, with mandatory over-length page charges beyond ~10–14) → emit over-length warning. **IEEE Access: no hard page cap** → suppress page check, surface word count + over-length APC note.

### 3.2 Elsevier elsarticle (`elsevier-elsarticle`)
- **Columns/layout:** single-column (`review`, `1p`, `3p`) or two-column (`5p`) via option; `review` gives double-spaced submission layout. Validate option appropriate to declared stage.
- **Abstract:** `\begin{abstract}…\end{abstract}`, ~**150–250 words** (journal-varying); single paragraph.
- **Keywords:** `\begin{keyword}…\end{keyword}`, items separated by `\sep`; default cap **6** (override to 10).
- **References:** numbered Vancouver default (`elsarticle-num.bst`) or author-year (`elsarticle-harv.bst`); any consistent style accepted at submission.
- **Highlights (mandatory for many journals):** **3–5** bullets, each **≤85 characters incl. spaces** — exactly machine-checkable; suppress for non-Elsevier families.
- **Length:** no fixed class limit → use word-count KPI (informational).

### 3.3 Springer sn-jnl (`springer-sn-jnl`)
- **Columns/layout:** default single-column (production applies final layout); pdflatex + natbib.
- **Reference style:** option-driven — `sn-basic`/`sn-vancouver-num`/`sn-mathphys-num` (numbered) vs `sn-apa`/`sn-chicago`/`-ay` (author-year). **Strong signal:** validate that the citation command (`\cite` vs `\citet`) matches the chosen option's numbered/author-year mode.
- **Abstract:** `\begin{abstract}…\end{abstract}`, soft cap ~**200** (warn at 250); single paragraph, no subheadings, no citations.
- **Keywords:** `\keywords[…]{…}`, recommended **3–6**.
- **Back matter:** Data Availability statement via `\bmhead{Data availability}` expected.
- **Stale-class warning:** flag `svjour3` (legacy) → recommend `sn-jnl`.

### 3.4 Springer LNCS (`springer-llncs`)
- **Columns/layout:** single-column, A4; `splncs04.bst` (numbered).
- **Abstract:** `\begin{abstract}…\end{abstract}`, **70–150 words** (flag below-min too).
- **Keywords:** `\keywords{…}` (separated by `\and` or commas), **≥1** required, recommended 3–6.
- **Page limit:** *per-CfP*, typically **12–15** pages incl. references; default 14, override per conference.
- **Double-blind:** many LNCS conferences are blind at review → anonymization check (see ACM §3.6).

### 3.5 MDPI (`mdpi`)
- **Class option:** `journal=<name>` is **mandatory** (e.g. `journal=sensors`); manuscripts off-template are returned before review. Validate the `Definitions/` folder is present.
- **Columns/layout:** single-column + line numbers at submission; two-column applied by production.
- **Abstract:** **≤200 words**, single paragraph, **no citations**.
- **Keywords:** **3–10**.
- **Required structured blocks:** Author Contributions; **Data Availability Statement**; Funding — each absent/empty block is a separate fail.
- **References:** `mdpi.bst`, numbered, **DOIs required**, full (non-abbreviated) journal names → lint `.bib` records for DOI presence.
- **Length:** no hard page limit → use **article-type word bands**: Research Article 4,000–10,000; Review 6,000–20,000; Communication 2,000–4,000; Brief Report 2,000–3,000.

### 3.6 ACM acmart (`acm-acmart`)
- **Template mode:** `sigconf` (two-column proceedings) / `acmsmall` (default journal) / `acmlarge`; `manuscript`/`review` give single-column double-spaced submission.
- **Required front matter:** **CCS Concepts** (`\ccsdesc` + `\begin{CCSXML}`) and **ACM Reference Format** are mandatory for papers >1 page; `\keywords{…}` required (≥1, soft-warn >8).
- **References:** `ACM-Reference-Format.bst` (required for >1 page).
- **Author/affiliation:** each `\author` must have `\affiliation{\institution{}\city{}\country{}}` + `\email{}`.
- **Double-blind:** at review, `anonymous` option must be set and no identifying names/emails/funding present; at camera-ready, `anonymous`/`review` removed and CCS/Reference-Format present.
- **TAPS-cleanliness:** source must compile cleanly for The ACM Publishing System.
- **Page limit:** per-CfP (default 10 + refs, override).

### 3.7 REVTeX 4.2 (`aps-revtex4-2`)
- **Society/journal option:** `[aps]`+`[prl]…[prx]/[prapplied]/[rmp]` or `[aip]`+`[jap]/[apl]/[rsi]`. Validate substyle matches target.
- **Columns/layout:** `[reprint]`/`[twocolumn]` (published look) vs `[preprint]` (single-column double-spaced).
- **Abstract:** `\begin{abstract}…\end{abstract}`.
- **References:** `apsrev4-2.bst` / `aipnum4-2.bst`, numbered.
- **Hard length (PRL):** **~3750 words / ~4 pages** when `[prl]` substyle is active → length-compliance check.

### 3.8 Generic article + ML-conference styles (`generic-article`)
- **Columns/layout:** single-column `article` default; venue `.sty` fixes columns.
- **Page limits via `.sty`:** NeurIPS ~**9** content pages + unlimited refs/appendix; ICML/ICLR ~**8–9** pages; AAAI per-kit; **CVPR/ICCV ~8 pages excluding references, references uncapped** (verified against CVPR 2025/2026 author guidelines — references are *not* counted and over-length papers are rejected without review).
- **References:** venue `.sty` usually fixes style (NeurIPS uses numbered natbib); otherwise author-chosen.
- **No publisher-enforced abstract/keyword caps** unless the venue `.sty` adds them — least "compliant by construction", so checks are advisory.

### 3.9 Cross-family core checks (apply to every template)
Undefined-reference/citation (`??`), multiply-defined labels, citation-without-bib-entry (+ inverse uncited entries), orphan/uncited floats, missing `\includegraphics` files, and **Overfull/Underfull `\hbox`/`\vbox`** layout-overflow counts — all parsed from `.log`/`.aux`/`.bbl` after a full `latex → bibtex → latex → latex` pass.

---

## 4. KPI System Design (three tiers) + Data Model

### Tier A — Manuscript / Format KPIs (the core; fully automatic)

Computed from **source + compiled PDF + auxiliary files**. No external data. These are Aloud's differentiator and map directly onto the read-aloud proofreading workflow.

| KPI | How computed | Unit | Auto |
|-----|--------------|------|------|
| Page count vs limit | PDF page count (`pdfinfo` `Pages:` / `len(PdfReader.pages)`) or `.log` "Output written … (N pages, …)"; compare to template limit | pages; compliant/over-by-k | ✅ |
| % of page/length limit used | `page/limit` or `word/limit` ×100; bucket <80% safe / 80–100% tight / >100% over | percent | ✅ |
| Total word count | TeXcount (`texcount -inc -total`) — markup/math-aware; or `detex \| wc -w` | words | ✅ |
| Abstract word count vs limit | isolate abstract env, count words, compare to per-family range | words | ✅ |
| Per-section word count | TeXcount `-sum -sub=section`, map to `\section{}` titles | words/section | ✅ |
| Figure / Table / Equation counts | count `figure(*)`/`table(*)`/numbered math envs in source, cross-check `.lof`/`.lot`/`.aux` | integers | ✅ |
| Reference count (cited vs in-.bib) | `\bibitem` in `.bbl`; intersect cite keys ∩ bib keys | integers | ✅ |
| Keyword / index-term count vs bounds | parse family keyword macro, split on delimiter (`\sep`/comma/`\and`), count | keywords | ✅ |
| Title length | strip `\title{}`, count words + chars vs limit | words, chars | ✅ |
| IMRaD / structure completeness | match `\section{}` titles to per-family required-section checklist (synonym matching) | % complete + missing list | ✅ |
| Estimated reading time | `words / WPM` (mark assumed rate, e.g. 200–250 WPM) | minutes (est.) | ✅ |
| Readability (Flesch / FK grade) | detex → `textstat`; mark approximate (math/detex residue perturbs sentences) | FRE 0–100; FK grade | ✅ |
| Undefined ref/cite (`??`) | scan `.log` "Reference/Citation `…' undefined"; diff cite/ref keys vs `.aux`/`.bbl` | count (0=clean) | ✅ |
| Multiply-defined labels | scan `.log` "Label … multiply defined" | count | ✅ |
| Citation-without-bib-entry + uncited entries | set-diff cite keys vs bib/.bbl keys | two counts | ✅ |
| Orphan figure/table (uncited float) | float `\label` keys with zero incoming `\ref`/`\cref` | count | ✅ |
| Overfull/Underfull box count | grep `.log` Over/Underfull `\hbox`/`\vbox` | count (+ overflow pt) | ✅ |
| **Family-specific rule checks** | abstract range, keyword bounds, required front-matter blocks, document-class match, ref-style compliance, author/affiliation well-formedness, Elsevier Highlights (3–5 / ≤85 chars), abstract structural purity (no `\cite`/equations), anonymization-state-matches-stage | pass/warn/fail per rule | ✅ |

### Tier B — Journal / Bibliometric KPIs (editable reference data per template/venue)

Venue-level; **cannot** be derived from the manuscript. Each value stores `asOfYear`, `source`, `confidence`, `userVerified`. **Auto-syncable** subset (free, by ISSN): CiteScore, SJR, SNIP, Scimago quartile+category, journal h-index (Scopus), APC/OA (DOAJ + OpenAlex), indexing flags (WoS Master Journal List + Scopus Source List). **Subscription-gated** (store as editable reference data when no Clarivate access): JIF, JCI, 5-Year IF, Eigenfactor/Article Influence, JCR quartile.

| KPI | Definition (short) | Source | Auto |
|-----|--------------------|--------|------|
| Journal Impact Factor (JIF) | 2-yr mean citations to citable items; WoS Core only | Clarivate JCR (WoS Journals API by ISSN) | ⚠️ subscription |
| Journal Citation Indicator (JCI) | field-normalized 3-yr CNCI; 1.0 = world avg; exists for ESCI | Clarivate JCR | ⚠️ subscription |
| 5-Year Impact Factor | JIF with 5-yr window; smoother for slow-citing fields | Clarivate JCR | ⚠️ subscription |
| CiteScore | 4-yr symmetric citations/docs; covers proceedings | Scopus Source List / Serial Title API (free) | ✅ |
| SJR (Scimago Journal Rank) | prestige-weighted (PageRank) 3-yr | Scimago JR portal / Scopus (free) | ✅ |
| SNIP | field-normalized citations/paper by citation potential | Scopus Source List (free) | ✅ |
| Quartile (Q1–Q4) **+ category** | rank within a *named* subject category; JCR (JIF) or Scimago (SJR) | JCR (subscription) / Scimago (free) | ◑ (Scimago side ✅) |
| Subject category / ASJC | WoS categories + Scopus ASJC; basis for all normalization | Scopus Source List (free) / WoS API (subscription) | ◑ |
| Eigenfactor / Article Influence | 5-yr citation-network importance; self-cites removed | JCR / eigenfactor.org | ⚠️ subscription |
| Journal h-index / h5-index | h papers with ≥h cites; h5 = last 5 yrs (Google Scholar) | Scopus (free) / GS Metrics (manual) | ◑ |
| APC / OA model | fee + Gold/Hybrid/Green/Diamond/Closed | DOAJ API + OpenAlex Source (free) | ✅ |
| Indexing status | SCIE/SSCI/AHCI/ESCI / Scopus / CPCI + source type | WoS Master Journal List + Scopus Source List (free) | ✅ |

> **Why category matters (and is mandatory):** quartile claims that omit category are routinely wrong. Store category *with* every quartile, and store the **source** (JCR vs Scimago) — they use different category schemes and can disagree.

### Tier C — Submission-Lifecycle KPIs (state machine + event log)

A controlled-vocabulary **state machine** with an **append-only status-event log** is the substrate; most durations/counts are then *derived* (auto) even though the authoritative status lives in the external portal (Editorial Manager / ScholarOne) which Aloud cannot scrape.

States: `drafting → internal-review → submitted → under-review → major-revision | minor-revision → accepted | rejected → published`, plus terminal/branch `withdrawn`, `desk-rejected`. Only legal transitions allowed.

| KPI | Computed | Auto |
|-----|----------|------|
| Lifecycle status | manual single-select; writes timestamped transition event | manual |
| Submission date (t0) | manual, or timestamp of `submitted` transition | manual/derived |
| Days under review (current round) | `now − under-review entry`; soft-benchmark ~30–37 days first-decision | ✅ derived |
| Time-to-first-decision | first decision event − submission; accumulates per-venue private benchmark | ✅ derived |
| Number of revision rounds | count transitions into `*-revision` (or resubmissions after R1) | ✅ derived |
| Desk-reject flag | manual boolean; heuristic suggest if `submitted→rejected` w/o review or <~14 days | manual |
| Target deadline / window | manual date (+ sub-type CFP/internal/revision-due); derive days-remaining | manual/derived |
| Co-author sign-off status | in-app approvals; **auto-invalidate on source hash change**; seed roster from `\author{}`/`\and` | ◑ |
| Response-to-reviewers completeness | segment pasted reviewer report into numbered comments; match each to a rebuttal block; flag unaddressed / missing line-pointer | ◑ |
| Internal-review turnaround | `submitted − internal-review entry` (wholly in-app) | ✅ derived |
| Total time-in-pipeline | terminal event − first submission; benchmark ~54 days w/ wide variance | ✅ derived |
| Stale-action / next-action-overdue | `today − last event` vs per-state threshold | ✅ derived |

### 4.1 Concrete Data Model

Stored per **template** (registry reference data) and per **project** (instance state).

```jsonc
// templates/<id>.json — shipped registry entry (editable in-app)
{
  "id": "mdpi",
  "name": "MDPI Article (Sensors)",
  "publisher": "MDPI",
  "documentClass": "mdpi",
  "classOptions": ["journal=sensors", "article"],
  "requiresAssets": ["Definitions/"],

  // ---- Tier-A format limits that drive auto-checks ----
  "format": {
    "columns": "single-at-submission",
    "abstract":  { "minWords": null, "maxWords": 200, "singleParagraph": true, "allowCitations": false },
    "keywords":  { "min": 3, "max": 10, "delimiter": "," },
    "refStyle":  { "allowed": ["mdpi"], "numbered": true, "requireDOI": true, "fullJournalNames": true },
    "pageLimit": null,                       // null => suppress page check
    "wordBands": {                            // used when pageLimit is null
      "Research Article": [4000, 10000],
      "Review": [6000, 20000],
      "Communication": [2000, 4000],
      "Brief Report": [2000, 3000]
    },
    "requiredBlocks": ["Author Contributions", "Data Availability Statement", "Funding"],
    "highlights": null,                       // Elsevier-only
    "doubleBlind": false
  },

  // ---- Tier-B bibliometrics: ALWAYS editable + provenance-stamped ----
  "venues": [
    {
      "venueName": "Sensors",
      "issn": "1424-8220",
      "metrics": {
        "jif":        { "value": 3.5, "asOfYear": 2024, "source": "Clarivate JCR (released Jun 2025)", "confidence": "high", "userVerified": false },
        "citeScore":  { "value": 8.2, "asOfYear": 2024, "source": "Scopus", "confidence": "high", "userVerified": false,
                        "note": "Newer Scopus release ~9.4; track whichever vintage you prefer." },
        "sjr":        { "value": 0.764, "asOfYear": 2024, "source": "Scimago", "confidence": "high", "userVerified": false },
        "quartiles":  [{ "label": "Q2", "category": "Instruments & Instrumentation", "scheme": "JCR", "asOfYear": 2024 },
                       { "label": "Q1", "category": "Instrumentation", "scheme": "Scopus/CiteScore", "asOfYear": 2024 }],
        "hIndex":     { "value": 273, "asOfYear": 2024, "source": "Scopus aggregators", "confidence": "medium", "userVerified": false }
      },
      "indexing": { "scie": true, "ssci": false, "ahci": false, "esci": false, "scopus": true, "cpci": false, "sourceType": "journal" },
      "oa": { "model": "Gold", "apc": { "amount": 2600, "currency": "CHF", "asOfYear": 2024, "source": "MDPI" } },
      "lifecycleRef": { "acceptanceRate": { "value": "~52–56%", "source": "MDPI-reported", "confidence": "low" } }
    }
  ]
}
```

```jsonc
// projects/<uuid>.json — per-project instance (Tier-A live metrics + Tier-C lifecycle)
{
  "projectId": "…",
  "templateId": "mdpi",
  "targetVenue": "Sensors",
  "articleType": "Research Article",

  "liveMetrics": {                            // recomputed on each compile
    "pages": 18, "words": 8123, "abstractWords": 213, "keywords": 5,
    "figures": 9, "tables": 3, "equations": 14, "refsCited": 47,
    "fleschReadingEase": 31.4, "fkGrade": 14.2, "readingMinutes": 36,
    "checks": {
      "abstract": { "status": "fail", "detail": "213 > 200-word MDPI cap" },
      "undefinedRefs": 0, "multiplyDefinedLabels": 0, "orphanFloats": 1,
      "overfullBoxes": 17, "requiredBlocks": { "Data Availability Statement": "missing" },
      "docClassMatch": true, "refStyleMatch": true
    }
  },

  "lifecycle": {
    "status": "under-review",
    "events": [                               // append-only
      { "ts": "2026-05-02T09:00:00Z", "from": "internal-review", "to": "submitted" },
      { "ts": "2026-05-09T12:00:00Z", "from": "submitted", "to": "under-review" }
    ],
    "submissionDate": "2026-05-02",
    "deadlines": [{ "type": "revision-due", "date": null }],
    "coAuthorSignoff": { "approved": 3, "total": 5, "approvedHash": "ab12…", "invalidatedOnEdit": true },
    "responseToReviewers": { "totalComments": null, "responded": null }
  }
}
```

---

## 5. Bibliometric Reference Table (shortlist venues)

**Read this first:** values are point-in-time snapshots, cross-checked against authoritative sources but **must remain user-verifiable and editable in-app**. `asOf` = citation/reference year of the metric; JCR figures released the following June. **The `Confidence` column and notes flag where aggregators disagree or inflate.** Cite the primary source (Clarivate JCR / Scopus / Scimago), never the aggregator, when publishing a number.

### Journals

| Venue | ISSN | JIF (asOf) | JIF source / confidence | CiteScore (asOf) | SJR | Best quartile + category | Indexing | OA model / APC |
|-------|------|-----------|--------------------------|------------------|-----|--------------------------|----------|----------------|
| **IEEE Access** | 2169-3536 | **3.6** (2024) | JCR; **high** | 9.0 (2024) | ~0.96 | Q2 — *CS, Information Systems / Eng., Electrical & Electronic / Telecommunications* (JCR); Q1 *CS (misc.)* (Scopus) | **SCIE** (not ESCI), Scopus, DOAJ | Gold; **USD 1,995** |
| **IEEE TPAMI** | 0162-8828 | **18.6** (2024) | JCR; **high** *(see note A)* | **35.0** (2024) | ~3.9 | Q1 — *CS, Artificial Intelligence* | SCIE, Scopus | Hybrid; opt OA ~USD 2,045–2,645 |
| **IEEE TIP** | 1057-7149 | **13.7** (2024) | JCR; **high** | 16.4 (2024) | ~2.50 | Q1 — *CS, AI / Eng., Electrical & Electronic* | SCIE, Scopus | Hybrid; opt OA ~USD 2,045–2,645 |
| **IEEE TNNLS** | 2162-237X | **8.9** (2024) | JCR; **high** *(see note B)* | 20.8 (2024) | ~3.69 | Q1 — *CS, AI (#4/130) / Hardware & Arch. (#1/50) / Theory & Methods (#2/97) / Eng., E&E (#4/252)* | SCIE, Scopus | Hybrid; opt OA ~USD 2,045–2,645 |
| **Sensors** (MDPI) | 1424-8220 | **3.5** (2024) | JCR; **high** | 8.2 (2024) *(newer Scopus ~9.4)* | 0.764 | Q2 — *Instruments & Instrumentation* (JCR); Q1 *Instrumentation* (Scopus) | SCIE, Scopus, PMC, DOAJ | Gold; **CHF 2,600** |
| **Remote Sensing** (MDPI) | 2072-4292 | **4.1** (2024) | JCR; **high** | 8.3 (2024) | 1.019 | Q1 — *Geosciences, Multidisciplinary* (JCR) **but Q2 in *Imaging Science & Photographic Technology*** *(see note C)* | SCIE, Scopus, DOAJ | Gold; **CHF 2,700** |
| **Pattern Recognition** (Elsevier) | 0031-3203 | **7.6** (2024) | JCR; **high** *(see note D)* | 15.5 (2024) | 2.058 | Q1 — *CS, AI / Eng., Electrical & Electronic* | SCIE, Scopus | Hybrid; opt OA USD 2,800 |
| **Neurocomputing** (Elsevier) | 0925-2312 | **6.5** (2024) | JCR; **high** | **10.8** (2024) *(not ~13; see note E)* | 1.471 | Q1 — *CS, AI (#37/204)* | SCIE, Scopus | Hybrid; opt OA USD 2,930 |
| **Expert Systems w/ Applications** (Elsevier) | 0957-4174 | **7.5** (2024) | JCR; **high** *(see note F)* | 12.2 (2024) | 1.854 | Q1 — *CS, AI / Eng., E&E / Operations Research* | SCIE, Scopus | Hybrid; opt OA USD 3,490 |
| **Information Fusion** (Elsevier) | 1566-2535 | **15.5** (2024) | JCR; **high** *(see note G)* | 28.4 (2024) | 4.128 | Q1 — *CS, AI (~#5) / CS, Theory & Methods* | SCIE, Scopus | Hybrid; opt OA USD 4,500 |
| **IJCV** (Springer) | 0920-5691 | **9.3** (2024) | JCR; **high** | 16.8 (2024) | ~4.0 | Q1 — *CS, AI / Computer Vision / Software* | SCIE, Scopus | Hybrid; opt OA ~USD 4,090 |
| **Machine Learning** (Springer) | 0885-6125 | **2.9** (2024); 5-yr ~6.6 | JCR; **medium** | **~7.2** (2024) *(not ~9; see note H)* | 1.147 | Q1 — *CS, AI* (by SJR) | SCIE, Scopus | Hybrid; opt OA ~USD 3,390 |

### Conferences / proceedings (no JIF — proceedings are not in JCR)

| Venue | Class / `.sty` | Quartile (Scimago, by SJR) | SJR | Indexing | Page limit | Acceptance | OA |
|-------|----------------|----------------------------|-----|----------|-----------|-----------|-----|
| **CVPR** (IEEE/CVF) | `cvpr.sty` (two-col) | Q1 — *Computer Vision & Pattern Recognition* | ~4.7 (2024; highest among CV) | Scopus (proceedings); **no JIF** | **8 pp excl. refs; refs uncapped** *(verified vs CVPR 2025/2026 guidelines)* | ~23.6% (2024) | CVF OA, no APC |
| **NeurIPS** | `neurips_20xx.sty` (1-col) | Q1 — *CS, AI / Signal Processing* | ~1.88 (2024) | Scopus; **no JIF** | ~9 content pp + unlimited refs/appendix | ~25–26% | proceedings OA, no APC |
| **ICCV** (IEEE/CVF) | `iccv.sty` (two-col) | Q1 — *CV & Pattern Recognition* | ~3.54 (2024) | Scopus; **no JIF** | 8 pp excl. refs | ~25–27% | CVF OA, no APC |
| **ECCV** (Springer LNCS) | `llncs.cls` (1-col) | Q1/Q2 — *via LNCS series, not ECCV-specific* | LNCS series ~0.6 *(series-level, uncertain)* | Scopus (LNCS); **no JIF** | ~14 pp excl. refs | ~25–30% | LNCS (subscription; opt OA) |

**Caveat on the conference rows:** ECCV's Scimago figures fold into the broad **LNCS series** and are *not* ECCV-specific — mark the SJR/h-index as approximate/series-level. CVPR/ICCV/NeurIPS SJR/h-index are the Scopus proceedings-series values.

#### Reconciliation notes (where aggregators disagree — verified for this document)
- **A — TPAMI:** authoritative 2024 JCR JIF = **18.6** (5-yr 20.4); 2023 = 20.8, 2022 = 23.6 *(declining trend)*. The widely-cited "21.19" is a **stale aggregator blend / predictive score**, not a clean Clarivate datapoint. CiteScore is **35.0**, not ">40". Sources: IEEE Computer Society press room; bioxbio (`IEEE-T-PATTERN-ANAL` → 2024:18.6, 2023:20.8, 2022:23.6); wos-journal.info; Scimago.
- **B — TNNLS:** authoritative 2024 JCR JIF = **8.9** (down from 10.2 in 2023; peaked 14.255 in 2021). The "13.72" from journalimpact.org is an **explicitly predictive** value ("increased by a factor of 1.89") — do **not** use. Sources: ooir.org (`2162-237X` → "8.900 based on Web of Science 2024"); bioxbio.
- **C — Remote Sensing:** Q1 only in *Geosciences, Multidisciplinary*; it is **Q2** in *Imaging Science & Photographic Technology* (and Q2 in WoS Remote Sensing / Environmental Sciences). Do not assert a blanket dual-Q1. Source: wos-journal.info (`11567`), MDPI announcement.
- **D — Pattern Recognition:** JCR 2024 = **7.6** (5-yr 7.9). The "9.84" on some aggregators is legacy/mislabeled. Name the engineering category precisely (*Engineering, Electrical & Electronic*). Sources: journalmetrics.org; wos-journal.info (`19520`).
- **E — Neurocomputing:** JCR 2024 = **6.5** (prior 5.5); CiteScore is **10.8**, *not* "~13". The "8.18" aggregator figure is predictive. Sources: wos-journal.info (`9267`); LetPub.
- **F — Expert Systems w/ Applications:** JCR 2024 = **7.5** (5-yr 7.8). The "10.48" circulating as "2024" is the **older JCR 2023 cycle**, not 2024. Sources: wos-journal.info (`19495`); journalmetrics.org; LetPub.
- **G — Information Fusion:** JCR 2024 = **15.5** (5-yr 17.9); "14.7" is the **2023** cycle; the "22.65" is a **Scopus-derived impact score, not the JIF** — keep it in a separate field. SCIE categories are *CS, AI* and *CS, Theory & Methods* (not "Information Systems"). Sources: wos-journal.info (`11626`); ooir.org; bioxbio (`INFORM-FUSION`).
- **H — Machine Learning (Springer):** JIF 2.9 (5-yr 6.6) confirmed; CiteScore is **~7.2**, *not* "~9". Q1 best-category is *CS, AI* (by SJR). Sources: wos-journal.info (`11518`); editage; Scimago.
- **IEEE Access metadata fix:** it is **SCIE-only** (carries a full JIF), *not* "SCIE/ESCI"; its real WoS categories are *CS, Information Systems / Eng., Electrical & Electronic / Telecommunications* — **not** any "multidisciplinary" category (that label belongs to Scopus). Sources: wos-journal.info (`15430`); DOAJ/ISSN portal.

> **General rule for the KPI engine:** source JIF/JCI/Eigenfactor from **Clarivate JCR** (or a JCR-faithful mirror: ooir.org, bioxbio, wos-journal.info), and source CiteScore/SJR/SNIP from **Scopus/Scimago**. **Never** ingest journalimpact.org / resurchify "impact score" fields into the JIF field — they are predictive or Scopus-derived and diverge materially from the official figure.

---

## 6. Implementation Notes for Aloud

### 6.1 `templates.js` registry shape

Extend the existing registry so each Sample Project carries (a) bootstrap files, (b) Tier-A format limits, and (c) Tier-B venue reference data. Keep `blank` and `sample` first-class.

```js
// templates.js
export const TEMPLATES = [
  { id: "blank",  name: "Blank Project", category: "generic",
    documentClass: "article", files: ["main.tex"], format: null, venues: [] },

  { id: "sample", name: "Demo Sample",   category: "demo",
    documentClass: "article", files: ["main.tex","refs.bib"], format: null, venues: [] },

  {
    id: "ieee-ieeetran",
    name: "IEEE (Transactions / Journals / Conferences)",
    category: "publisher",
    publisher: "IEEE",
    documentClass: "IEEEtran",
    classOptions: ["journal"],            // user can switch to conference/technote
    variants: ["journal", "conference", "technote", "access"], // access => ieeeaccess.cls
    files: ["main.tex", "IEEEtran.cls", "IEEEtran.bst", "refs.bib"],
    format: {                              // → Tier-A auto-checks
      columns: "two", abstract: { min: 150, max: 250, allowCitations: false },
      keywords: { macro: "IEEEkeywords", min: 2, max: 5 },
      refStyle: { allowed: ["IEEEtran"], numbered: true },
      pageLimit: { default: 12, perVenue: true, overLengthCharges: true } // suppressed for access
    },
    venues: [ /* ISSN-keyed Tier-B objects, see §4.1 */ ],
    docs: "https://ctan.org/pkg/ieeetran"
  },

  /* elsevier-elsarticle, springer-sn-jnl, springer-llncs, mdpi,
     generic-article (+ neurips/icml/iclr/aaai .sty), acm-acmart, aps-revtex4-2 … */
];

// helpers the gallery + KPI panel consume
export const getTemplate    = (id) => TEMPLATES.find(t => t.id === id);
export const galleryEntries = () => TEMPLATES.filter(t => t.category !== "demo" || SHOW_DEMO);
```

**Bundled-asset rule:** MDPI needs the full `Definitions/` folder; LNCS needs `llncs.cls` + `splncs04.bst`; ACM needs `acmart.cls` + `ACM-Reference-Format.bst`; ML-conference variants drop in `neurips_20xx.sty` / `icml…` / `iclr…` / `aaai.sty`. Store these under each template's asset bundle and copy them on project creation. Respect class licenses (IEEEtran, elsarticle, revtex, acmart are freely redistributable via CTAN; for publisher kits, link to the official source and/or fetch the latest from CTAN/Overleaf rather than vendoring stale copies).

### 6.2 New-Project gallery

- **Card per template:** name, publisher logo, one-line "why ship", a coverage badge ("WoS SCIE + Scopus" / "Scopus proceedings — no JIF"), and a relevance tag (AI/ML, CV, Sensors, Conference).
- **Group by intent:** *Journals* (IEEE/Elsevier/Springer/MDPI/REVTeX), *Conferences* (LNCS, ACM sigconf, ML-conf `article`+`.sty`, IEEE conference mode), *Generic* (Blank, Sample, arXiv preprint).
- **Variant picker** on the card for umbrella classes (IEEEtran journal/conference/technote/Access; elsarticle review/1p/3p/5p; sn-jnl reference-style option; acmart sigconf/acmsmall/manuscript+anonymous).
- **Target-venue field** on creation seeds `targetVenue` + pulls that venue's Tier-B reference block and Tier-A limits, so the KPI panel is venue-aware immediately. Show the `asOfYear` + "values are editable / verify against the journal" notice inline.

### 6.3 In-editor KPI panel

A live side-panel that compares **current manuscript metrics** to the **selected template/venue limits**, recomputed on each compile.

- **Three sections mirroring the tiers:**
  1. **Format compliance (Tier-A):** traffic-light rows — Abstract `213/200 ✗`, Keywords `5/3–10 ✓`, Page `18 (no limit — word band 4k–10k: 8,123 ✓)`, Overfull boxes `17 ⚠`, Undefined refs `0 ✓`, Orphan floats `1 ⚠`, Required blocks `Data Availability: missing ✗`. Each row links to the offending source location and (for prose readability rows) hooks into the **read-aloud proofreader**.
  2. **Venue bibliometrics (Tier-B):** JIF/CiteScore/SJR/quartile+category/APC/OA/indexing, each with its `asOf` badge, `source`, a small **confidence dot**, and an inline **edit pencil** (sets `userVerified: true`). Show the reconciliation note where one exists (e.g. "aggregators show 21.19 — JCR is 18.6").
  3. **Lifecycle (Tier-C):** current state, days-under-review vs benchmark, stale-action flag, co-author sign-off `3/5`, response-to-reviewers completeness.
- **Gauge widget:** a single "how full am I" bar (% of page or word limit) bucketed safe / tight / over — the most-glanced signal.
- **Suppression logic:** if `format.pageLimit == null` (Access/Elsevier/MDPI), hide the page-limit row and show the word-band row instead, to avoid false alarms.
- **Recompute pipeline:** on compile, run `latex → bibtex → latex → latex`, then parse PDF (`pdfinfo`/pypdf), `.log` (overfull boxes, undefined refs, multiply-defined labels, page count), `.aux`/`.bbl` (cite/label integrity), and TeXcount (`-inc -sum -sub=section`) for words/abstract/section counts. Cache results on the project's `liveMetrics`.
- **Never block on bibliometrics being stale:** Tier-B values are advisory reference data; surface their age, prompt re-verification at template load, but never gate compilation or submission on them.

---

### Appendix — Primary sources cited inline
- CTAN: [ieeetran](https://ctan.org/pkg/ieeetran), [elsarticle](https://ctan.org/pkg/elsarticle), [revtex](https://ctan.org/pkg/revtex); Springer Nature `sn-jnl` (Overleaf template, option list `sn-basic … sn-chicago`); Springer "Information for LNCS Authors" (`llncs` v2.24, `splncs04.bst`); MDPI ["Preparing Manuscripts in LaTeX"](https://www.mdpi.com/authors/latex); ACM ["Primary Article Template"](https://www.acm.org/publications/proceedings-template); APS [REVTeX](https://journals.aps.org/revtex).
- Bibliometrics: Clarivate JCR (authoritative JIF/JCI); [IEEE Computer Society press room](https://www.computer.org/press-room/ieee-computer-society-journals-top-impact-factor-rankings) (TPAMI 18.6); [bioxbio](https://www.bioxbio.com/) (IF history, e.g. `IEEE-T-PATTERN-ANAL`, `INFORM-FUSION`); [ooir.org](https://ooir.org/) (TNNLS `2162-237X` → 8.9); [wos-journal.info](https://wos-journal.info/) (per-journal SCIE categories + JIF); [Scimago JR](https://www.scimagojr.com/) (SJR/quartile); Scopus Source List / CiteScore; [DOAJ](https://doaj.org/) + [OpenAlex](https://openalex.org/) (APC/OA); WoS Master Journal List (indexing).
- Venue format rules: CVPR 2025/2026 Author Guidelines (8 pp excl. refs; refs uncapped); MDPI Sensors announcements (IF 3.5 / CiteScore 8.2, newer ~9.4).

> ⚠️ **Final reminder:** treat every bibliometric value here as editable reference data with provenance, not ground truth. Pull JIF from Clarivate JCR and CiteScore/SJR/SNIP from Scopus/Scimago at template-load time where licensing permits; otherwise let the user verify and stamp `userVerified`. Aggregator "impact scores" are predictive or Scopus-derived and must never populate the JIF field.
