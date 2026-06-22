# PaperBanana → Publify bridge service.
#
# A tiny FastAPI wrapper around the PaperBanana pipeline (https://github.com/dwzhu-pku/PaperBanana,
# Apache-2.0). Publify's `paper-figure` Edge function POSTs to /figure; this service runs PaperBanana and
# returns the candidate images in the exact shape Publify expects:
#
#   POST /figure  { "method": "...", "caption": "...", "task": "diagram|plot", "n": 4, "mode": "dev_full" }
#   -> 200       { "candidates": [ { "mime": "image/png", "dataUrl": "data:image/png;base64,..." }, ... ],
#                  "trace": [ "Planner …", "Stylist …", "Visualizer …", "Critic …" ] }
#
# PaperBanana is PURE API ORCHESTRATION (no GPU) — it only calls a VLM (Gemini/OpenRouter) + an image-gen
# API. So this can run on any small container (Modal / Cloud Run / Railway / Fly / a VPS). Set the model
# keys for PaperBanana itself (configs/model_config.yaml or env), and PB_BRIDGE_TOKEN here for a shared
# bearer that must match Publify's PAPERBANANA_TOKEN secret.
#
# Run:
#   uv pip install fastapi uvicorn[standard]          # plus PaperBanana's own deps (uv sync in its repo)
#   PB_BRIDGE_TOKEN=<secret> uvicorn app:app --host 0.0.0.0 --port 8000
# then in Supabase:
#   supabase secrets set PAPERBANANA_ENDPOINT=https://<this-host>
#   supabase secrets set PAPERBANANA_TOKEN=<secret>

import base64
import os
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="PaperBanana → Publify bridge")
TOKEN = os.environ.get("PB_BRIDGE_TOKEN", "")


class FigureReq(BaseModel):
    method: str = ""
    caption: str = ""
    task: str = "diagram"          # "diagram" | "plot"
    n: int = 4                     # number of candidates
    mode: str = "dev_full"         # PaperBanana exp_mode


class Candidate(BaseModel):
    mime: str = "image/png"
    dataUrl: str


class FigureResp(BaseModel):
    candidates: List[Candidate]
    trace: Optional[List[str]] = None


def _png_to_dataurl(path: str) -> str:
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")


def run_paperbanana(req: FigureReq) -> FigureResp:
    """Run the PaperBanana pipeline and collect the candidate PNGs.

    ─────────────────────────────────────────────────────────────────────────────────────────────
    WIRE THIS TO PAPERBANANA. Two ways:

    (A) Import the agents directly (cleanest — PaperBanana exposes an `agents/` module):

        from agents import Planner, Stylist, Visualizer, Critic, Retriever   # adjust to actual names
        plan   = Planner().run(method=req.method, caption=req.caption, task=req.task)
        styled = Stylist().run(plan)
        imgs   = Visualizer().run(styled, n=req.n)            # -> list of PNG paths
        imgs   = Critic().refine(imgs, styled)               # iterative loop (mode-dependent)
        return FigureResp(
            candidates=[Candidate(dataUrl=_png_to_dataurl(p)) for p in imgs],
            trace=["Planner ✓", "Stylist ✓", f"Visualizer ✓ ({len(imgs)})", "Critic ✓"],
        )

    (B) Shell out to its CLI and read results/ (no internal API needed):

        import subprocess, glob, tempfile, json
        inp = tempfile.mkdtemp()
        json.dump({"method": req.method, "caption": req.caption}, open(f"{inp}/input.json", "w"))
        subprocess.run(["python", "main.py", "--task_name", req.task, "--exp_mode", req.mode,
                        "--retrieval_setting", "none", "--input_dir", inp, "--num_candidates", str(req.n)],
                       cwd=os.environ["PAPERBANANA_DIR"], check=True)
        pngs = sorted(glob.glob(os.path.join(os.environ["PAPERBANANA_DIR"], "results", "**", "*.png"), recursive=True))[-req.n:]
        return FigureResp(candidates=[Candidate(dataUrl=_png_to_dataurl(p)) for p in pngs])
    ─────────────────────────────────────────────────────────────────────────────────────────────
    """
    raise HTTPException(
        status_code=501,
        detail="run_paperbanana() is a stub — wire it to the PaperBanana pipeline (see the docstring). "
               "Until then Publify falls back to placeholder figures when PAPERBANANA_ENDPOINT is unset.",
    )


@app.get("/health")
def health():
    return {"ok": True, "service": "paperbanana-bridge", "wired": False}


@app.post("/figure", response_model=FigureResp)
def figure(req: FigureReq, authorization: str = Header(default="")):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="bad bridge token")
    if not (req.caption or req.method):
        raise HTTPException(status_code=400, detail="method or caption required")
    req.n = max(1, min(20, req.n))
    return run_paperbanana(req)
