#!/usr/bin/env python3
"""Publify self-hosted research worker (R4 — compute offload).

Polls the research_jobs queue via the Supabase REST API (service-role key), runs each job on THIS
machine (the compute the platform offloads to), and writes results back. Stdlib only — no pip installs.

Config (env, with sensible local defaults):
  SUPABASE_URL          default: parsed from ../backend/config.js
  SUPABASE_SERVICE_KEY  default: ~/.publify-supabase-key
  WORKER_POLL_SECONDS   default: 5
  WORKER_PY_TIMEOUT     default: 60   (seconds per python job)

Usage:
  python3 research_worker.py            # loop forever
  python3 research_worker.py --once     # one poll, then exit (good for cron)

Job types:
  python   spec.code        -> runs the snippet in a temp dir (timeout), captures stdout
  stats    spec.dataset_id  -> downloads the dataset, summarises numeric CSV columns
  download spec.dataset_id  -> fetches a registered URL dataset locally, marks it ready
"""
import os, sys, re, io, csv, json, time, statistics, tempfile, subprocess, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------
# Pure executors (unit-testable without any network / DB)
# ----------------------------------------------------------------------------
def run_python(code, timeout=60, python=None):
    """Run a snippet in an isolated temp dir. Returns (result_dict, logs, ok)."""
    python = python or sys.executable
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "job.py")
        with open(path, "w") as f:
            f.write(code or "")
        try:
            r = subprocess.run([python, path], capture_output=True, text=True, timeout=timeout, cwd=d)
            ok = r.returncode == 0
            return ({"returncode": r.returncode, "stdout": (r.stdout or "")[-4000:]},
                    ((r.stdout or "") + (r.stderr or ""))[-8000:], ok)
        except subprocess.TimeoutExpired:
            return ({"error": "timeout"}, "timed out after %ss" % timeout, False)


def summarize_csv(text):
    """Summary stats for numeric columns of a CSV string."""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return {"rows": 0, "columns": 0, "numeric": {}}
    header, data = rows[0], rows[1:]
    cols = {}
    for i, name in enumerate(header):
        vals = []
        for r in data:
            if i < len(r):
                try:
                    vals.append(float(r[i]))
                except ValueError:
                    pass
        if vals:
            cols[name] = {"count": len(vals), "mean": round(statistics.mean(vals), 4),
                          "min": min(vals), "max": max(vals)}
    return {"rows": len(data), "columns": len(header), "numeric": cols}


def run_stats(fetch_bytes):
    """fetch_bytes() -> bytes of a CSV. Returns (result, logs, ok)."""
    raw = fetch_bytes()
    text = raw.decode("utf-8", "replace")
    return (summarize_csv(text), "analyzed %d bytes" % len(raw), True)


def download_url(url, dest_dir):
    name = re.sub(r"[^A-Za-z0-9._-]", "_", (url.split("/")[-1] or "data"))
    dest = os.path.join(dest_dir, name)
    urllib.request.urlretrieve(url, dest)
    return dest, os.path.getsize(dest)


# ----------------------------------------------------------------------------
# Supabase REST plumbing
# ----------------------------------------------------------------------------
def load_config():
    url = os.environ.get("SUPABASE_URL")
    if not url:
        try:
            cfg = open(os.path.join(ROOT, "..", "backend", "config.js")).read()
            m = re.search(r"supabaseUrl:\s*'([^']+)'", cfg)
            url = m.group(1) if m else None
        except OSError:
            pass
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not key:
        try:
            key = open(os.path.expanduser("~/.publify-supabase-key")).read().strip()
        except OSError:
            pass
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or ~/.publify-supabase-key).")
    return url.rstrip("/"), key


class DB:
    def __init__(self, url, key):
        self.url, self.key = url, key

    def _req(self, method, path, body=None, headers=None):
        h = {"apikey": self.key, "Authorization": "Bearer " + self.key, "Content-Type": "application/json"}
        if headers:
            h.update(headers)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=h, method=method)
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    def next_queued(self, limit=5):
        return self._req("GET", "/rest/v1/research_jobs?status=eq.queued&order=created_at.asc&limit=%d" % limit) or []

    def claim(self, job_id):
        # optimistic claim: only succeeds if still queued
        out = self._req("PATCH", "/rest/v1/research_jobs?id=eq.%s&status=eq.queued" % job_id,
                        {"status": "running", "started_at": _now()}, {"Prefer": "return=representation"})
        return bool(out)

    def finish(self, job_id, status, result=None, logs=None):
        self._req("PATCH", "/rest/v1/research_jobs?id=eq.%s" % job_id,
                  {"status": status, "result": result, "logs": (logs or "")[-8000:], "finished_at": _now(), "progress": 100})

    def get_dataset(self, dsid):
        rows = self._req("GET", "/rest/v1/research_datasets?id=eq.%s&select=*" % dsid)
        return rows[0] if rows else None

    def set_dataset(self, dsid, fields):
        self._req("PATCH", "/rest/v1/research_datasets?id=eq.%s" % dsid, fields)

    def add_log(self, project_id, profile_id, summary, ltype="RESULT"):
        # so finished compute shows up in the research log (and the supervisor's daily digest)
        if not profile_id:
            return
        try:
            self._req("POST", "/rest/v1/research_log",
                      {"project_id": project_id, "profile_id": profile_id, "type": ltype, "summary": summary})
        except Exception:  # noqa  (logging is best-effort)
            pass

    def storage_bytes(self, path):
        # download an object from the research-data bucket (service key)
        url = self.url + "/storage/v1/object/research-data/" + urllib.parse.quote(path)
        req = urllib.request.Request(url, headers={"apikey": self.key, "Authorization": "Bearer " + self.key})
        with urllib.request.urlopen(req) as r:
            return r.read()


def _now():
    # ISO-ish timestamp without importing datetime's now() at module import (kept simple)
    import datetime
    return datetime.datetime.utcnow().isoformat() + "Z"


def dataset_bytes(db, dataset):
    if dataset.get("source") == "upload" and dataset.get("uri"):
        return db.storage_bytes(dataset["uri"])
    if dataset.get("uri"):
        with urllib.request.urlopen(dataset["uri"]) as r:
            return r.read()
    raise RuntimeError("dataset has no fetchable uri")


# ----------------------------------------------------------------------------
# Dispatch + loop
# ----------------------------------------------------------------------------
def process(db, job, py_timeout=60):
    jtype, spec = job.get("type"), (job.get("spec") or {})
    try:
        if jtype == "python":
            result, logs, ok = run_python(spec.get("code", ""), timeout=py_timeout)
        elif jtype == "stats":
            ds = db.get_dataset(spec.get("dataset_id"))
            if not ds:
                result, logs, ok = None, "dataset not found", False
            else:
                result, logs, ok = run_stats(lambda: dataset_bytes(db, ds))
        elif jtype == "download":
            ds = db.get_dataset(spec.get("dataset_id"))
            if not ds or not ds.get("uri"):
                result, logs, ok = None, "dataset not found / no uri", False
            elif not str(ds["uri"]).startswith("http"):
                result, logs, ok = None, "non-URL source needs a provider CLI (hf/kaggle) — not supported by the stdlib worker", False
            else:
                ddir = os.path.join(ROOT, "downloads", ds["id"])
                os.makedirs(ddir, exist_ok=True)
                path, size = download_url(ds["uri"], ddir)
                db.set_dataset(ds["id"], {"status": "ready", "local_path": path, "size_bytes": size})
                result, logs, ok = {"path": path, "size_bytes": size}, "downloaded %d bytes" % size, True
        else:
            result, logs, ok = None, "unknown job type: %s" % jtype, False
        db.finish(job["id"], "done" if ok else "error", result, logs)
        if ok:
            db.add_log(job["project_id"], job.get("created_by"),
                       'Compute job "%s" (%s) finished' % (job.get("title", "job"), jtype))
        print("  job %s [%s] -> %s" % (job["id"][:8], jtype, "done" if ok else "error"))
    except Exception as e:  # noqa
        db.finish(job["id"], "error", None, "worker exception: %r" % e)
        print("  job %s [%s] -> error: %r" % (job["id"][:8], jtype, e))


def main():
    once = "--once" in sys.argv
    url, key = load_config()
    db = DB(url, key)
    poll = int(os.environ.get("WORKER_POLL_SECONDS", "5"))
    py_timeout = int(os.environ.get("WORKER_PY_TIMEOUT", "60"))
    print("research worker -> %s  (poll %ss, %s)" % (url, poll, "once" if once else "loop"))
    while True:
        jobs = db.next_queued()
        for job in jobs:
            if db.claim(job["id"]):
                process(db, job, py_timeout)
        if once:
            print("done (%d job(s))." % len(jobs))
            return
        time.sleep(poll)


if __name__ == "__main__":
    main()
