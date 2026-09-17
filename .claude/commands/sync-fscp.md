---
description: Governed sync of fs-cp with current fs-cc/fs-enrs HEAD (read-first, LF-identical, no commit/push)
argument-hint: [optional note, e.g. "new STT service in fs-enrs/services/stt" or "build images too"]
---
You are syncing the integration repo **fs-cp** with the CURRENT authoritative HEADs of
`fs-cc` and `fs-enrs`, following `CLAUDE.md` and `FS-CP-GOVERNANCE.md` in this repo.
The CURRENT repository state is the authority — NEVER trust prior sync reports or commit
messages; rediscover everything.

## HARD RULES
- Authoritative source = fs-cc / fs-enrs. fs-cp only CONSUMES. Never edit application code
  inside fs-cp; if app code differs, the authoritative repo wins.
- **Do NOT commit or push.** Leave changes uncommitted for my review.
- Read-only first: present the plan before any edit.
- **PRESERVE fs-cp-local files** (never overwrite/delete) — see CLAUDE.md "Preserve-List".
  In short: `deploy/**`, each app's `backend/Dockerfile`, `docker-entrypoint.sh`,
  `backend/scripts/*`, `services/*/Dockerfile`, `validator.js`, all `.env` / `.env.*`
  (secrets stay local; only `.env.example` is tracked), and any file present in fs-cp but
  absent from the authoritative repo (default: PRESERVE, and report it).
- NO schema/migration authored in fs-cp, NO FreeSWITCH config, NO Docker-architecture
  redesign, NO timezone/auth/Socket.IO redesign, NO unrelated refactor, NO new deps —
  unless the authoritative change genuinely requires it, in which case STOP and report.
- Copy only the CURRENT **coherent feature set** + its tight dependencies (backend +
  frontend + routes + services + migrations + config + package.json/lock + tests that make
  the feature work as a unit). Synced app files must be **LF-identical** to authoritative
  HEAD — verify with git blob/diff, not by eye.

## PROCEDURE
1. Report HEAD / branch / working-tree of fs-cc, fs-enrs, fs-cp.
2. LF-normalized diff of each authoritative HEAD vs its fs-cp embed. Classify every file:
   **ADD / UPDATE / PRESERVE (fs-cp-local) / AMBIGUOUS.** Investigate each AMBIGUOUS file
   (is it a deliberate fs-cp customization?) before deciding.
3. Trace any NEW env/config var end-to-end (Docker/compose → process env → config loader →
   backend → business logic). Wire required new vars into `deploy/docker-compose.yml`
   (service `environment:`) + `deploy/.env.example` (documented placeholder, NEVER a real
   secret). Remember: a backend that fail-fasts on a missing required var will crash-loop
   if this wiring is skipped.
4. For a NEW standalone service (like Piper — e.g. a future STT/agent service): confirm its
   compose service, Dockerfile (build context in the authoritative repo), network entry,
   healthcheck, and the dual-URL pattern (FS-CP-GOVERNANCE.md §5/§14). Reuse the pattern;
   do not invent a new one.
5. Present the plan (files to change, files preserved, env/DB/Docker impact, any single
   decision needed). If nothing is ambiguous, continue autonomously.
6. Apply the sync (LF-identical copies), then VERIFY every synced app file == authoritative
   HEAD (git blob compare, 0 mismatches expected aside from documented fs-cp-local files).
7. Run the authoritative repo's test suite for the changed side(s); report ACTUAL results.
8. Docker build ONLY if this run's note says so (e.g. "build images too"): `docker compose
   config` then `docker compose build` the affected services; otherwise report Docker as a
   separate, un-run gate.
9. Show `git status` / `git diff --stat` / `git diff --check`, then STOP. Do NOT commit or
   push. Give an evidence-based report: files changed, files preserved, env changes,
   migrations detected, tests (actual PASS/FAIL), and any BLOCKERS. Do not claim
   "production ready" unless the build+validation gates you actually ran passed.

## STOP CONDITIONS (ask before proceeding)
- An authoritative change would require a schema migration, FreeSWITCH change, Docker
  redesign, or editing fs-cp app code.
- You cannot determine whether a differing file is fs-cp-local or stale.
- The working tree has unexpected local changes that overlap the files to sync.

Focus / what changed this run (optional): $ARGUMENTS
