# AI Review — workflow findings as in-context review notes

Aloud can ingest the output of an agentic **review workflow** and surface every finding
as an anchored note right on the manuscript, so the whole thesis can be reviewed in place.

## How it works

1. A review workflow examines the LaTeX source across dimensions — **style/language,
   technical/engineering, claims, citations, equations, figures/tables, structure,
   reproducibility** — and emits findings, each with an **exact verbatim quote** from the
   source plus a category, severity, comment and suggestion.
2. The findings are written to a JSON file (`*.review.json`):

   ```json
   { "findings": [
     { "file": "main.tex", "quote": "<exact substring from the source>",
       "category": "claim", "severity": "major",
       "comment": "...", "suggestion": "...", "confidence": "high" }
   ] }
   ```
3. In the editor, open the **Review** tab (✦ in the collaboration toolbar) → **Import…**,
   and pick the `.review.json`. Each finding's quote is located in the text and turned into
   an anchored `review` annotation.

## What you see

- **Preview & compiled PDF:** the sentence each note refers to is tinted by severity
  (red = major, amber = minor, grey = nit) with a small **✦** marker. Click it to jump to
  the note.
- **Review panel:** all findings, sorted by severity, each with its category, the AI
  comment, a concrete suggestion, and the anchored quote. **Jump** scrolls to the sentence;
  **Mark resolved** clears its marker; **Delete** removes it. A summary line counts open
  findings by severity.

Notes that can't be located in the current text (e.g. after heavy edits) are listed as
`unanchored` so nothing is silently lost.

## Demo

The bundled doctoral thesis (`Doctoral_Workflow_v8/Overleaf_v18_3/`) ships with a real
review run: **`Doctoral_Thesis_v18_3_HU.review.json`** (286 verified findings) and
`THESIS_REVIEW_SUMMARY.md` (executive summary). Upload the Overleaf bundle into Aloud,
then Review → Import that `.review.json`.

Review notes are stored as `kind: "review"` annotations, separate from human comments/
to-dos, and persist with the project (demo localStorage or cloud).
