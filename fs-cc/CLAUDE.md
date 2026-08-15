# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Role — Contact Center Authoritative Source

**fs-cc is the authoritative development repository for the Contact Center application.**

All Contact Center application development happens here:

- CC backend (Node.js)
- CC frontend
- CC database migrations
- CC business logic and APIs
- CC authentication and authorization
- CC UI
- CC tests
- CC bug fixes and features
- CC security fixes

The latest valid CC application code **must** come from this repository.

## Multi-Repository Context

This repository is one of three:

| Repository | Role |
|---|---|
| **fs-enrs** | ENRS application — authoritative source |
| **fs-cc** | Contact Center application — authoritative source (this repo) |
| **fs-cp** | Integration + deployment only — consumer of fs-enrs and fs-cc |

## Non-Negotiable Rules

1. **All CC application changes originate here.** Never develop CC code in fs-cp.
2. **Never modify ENRS code here.** ENRS code belongs in fs-enrs.
3. **After committing here, promote to fs-cp** — not before.
4. **fs-cp is a consumer.** If a CC bug is found during fs-cp integration testing, fix it here first, then sync to fs-cp.

## Bug Fix Rule

If a CC bug is discovered during fs-cp integration:

1. Fix it here in fs-cc.
2. Test it here.
3. Commit it here.
4. Promote the tested commit to fs-cp.
5. Rebuild the Docker image in fs-cp.

Never fix CC application code directly in fs-cp.

## Commands

### Backend (run from `backend/`)
```bash
npm run dev      # development server
npm start        # production start
npm test         # run tests
```

### Frontend
```bash
npm run dev      # development server
npm run build    # production build
```

## Phase Protocol

Any task touching more than one repository must proceed in phases with explicit approval between phases. See `fs-enrs/GOVERNANCE.md` — Multi-Repository Governance section for the full protocol.
