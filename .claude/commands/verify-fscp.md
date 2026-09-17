---
description: READ-ONLY forensic compare of fs-cp embeds vs current fs-cc/fs-enrs HEAD (no changes)
argument-hint: [optional focus, e.g. "fs-cc only"]
---
READ-ONLY verification. Make NO changes, NO commits, NO pushes, NO Docker builds, and do
NOT touch the WSL/dev server. Purpose: show whether `fs-cp/fs-cc` and `fs-cp/fs-enrs` match
the CURRENT authoritative HEADs, and surface drift before/after a `/sync-fscp`.

## STEPS
1. Report HEAD / branch / working-tree for fs-cc, fs-enrs, fs-cp.
2. For each authoritative repo (respect the optional focus in $ARGUMENTS):
   - LF-normalized blob compare of every file that fs-cp embeds vs the authoritative HEAD.
   - Output four lists: **DIFF (needs update)**, **MISSING (needs add)**,
     **fs-cp-local (expected, preserve)**, **AMBIGUOUS**.
   - fs-cp-local files that are EXPECTED to differ (do not flag as drift): each app's
     `backend/Dockerfile`, `docker-entrypoint.sh`, `backend/scripts/*`,
     `services/*/Dockerfile`, `validator.js`, and any `.env`/`.env.*`. Everything else that
     differs IS drift.
3. Report env-var reconciliation: any env var required by the authoritative backend config
   that is NOT present in `deploy/docker-compose.yml` + `deploy/.env.example`
   (a missing required var = a crash-loop risk at deploy time).
4. Verdict per repo: **IN SYNC** (only expected fs-cp-local differences) or **DRIFTED**
   (list the exact files). No changes made.

Focus (optional): $ARGUMENTS
