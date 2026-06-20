# Publify self-hosted research worker (R4 — compute offload)

The compute the platform offloads to. It polls the `research_jobs` queue (Supabase REST, service-role
key), runs each job **on this machine**, and writes results back so they appear in the Research
workspace → a project → **Compute** tab. Stdlib only — no `pip install`.

## Run

```bash
# uses ~/.publify-supabase-key and ../backend/config.js by default
python3 research_worker.py            # loop (poll every 5s)
python3 research_worker.py --once     # one poll then exit  (use from cron / launchd)

# or with explicit env:
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_KEY=sb_secret_... \
WORKER_PY_TIMEOUT=120 \
python3 research_worker.py
```

Prereq: run `backend/migration-15-research-data-jobs.sql` first (creates `research_jobs`,
`research_datasets`, the `research-data` Storage bucket).

## Job types

| type       | spec                | what it does |
|------------|---------------------|--------------|
| `python`   | `{ code }`          | runs the snippet in a temp dir with a timeout, captures stdout/returncode |
| `stats`    | `{ dataset_id }`    | fetches the dataset (Storage upload or URL) and summarises numeric CSV columns |
| `download` | `{ dataset_id }`    | downloads a registered **URL** dataset locally, marks it `ready` (hf:/kaggle: need their CLI) |

Results land in `research_jobs.result` (small JSON) / `logs`; downloaded files under `worker/downloads/`.

## Security notes

- `python` jobs execute arbitrary code **on the worker host** — run the worker on a box you control,
  ideally a throwaway VM/container, not a machine with secrets. A future hardening step: run each job
  in a container with no network and a CPU/memory cap.
- The service-role key bypasses RLS — keep it on the worker host only (never in the browser).
- The worker claims jobs optimistically (`PATCH ... &status=eq.queued`) so multiple workers won't
  double-run the same job.

## Schedule (optional)

`cron` every minute:
```
* * * * * cd /path/to/Aloud/worker && /usr/bin/python3 research_worker.py --once >> worker.log 2>&1
```
