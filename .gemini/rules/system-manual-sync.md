---
description: Automated System Manual Synchronization Rule
globs: **/*
---

# Automated System Manual Synchronization Rule

Every time modifications are made to any core components of this system:
1. **Frontend Views & Routes** (`frontend/index.html`, `frontend/js/router.js`)
2. **Keyboard Shortcuts & POS Handlers** (`frontend/js/modules/sales.js`)
3. **Roles & RBAC Permissions** (`backend/Auth.gs`, `backend/Setup.gs`, `frontend/js/auth.js`)
4. **Database Sheets & Schema** (`backend/Db.gs`, `backend/Setup.gs`)
5. **API Endpoints & Actions** (`backend/Code.gs`, `frontend/js/api.js`)

You MUST perform the following synchronization and verification steps:
1. Run `node scripts/update-manual.js` (or `npm run manual:update`) to update `docs/USER_MANUAL.md` and `frontend/js/modules/manualData.js`.
2. Run `npm run manual:verify` to confirm that all views, shortcuts, roles, and schema are documented.
3. Run `npm test` (or `node --test tests/*.test.js`) to ensure all tests pass.
4. Keep the documentation in sync with the codebase at all times to eliminate documentation drift.
