# Character Store Admin Review Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable server-side review key before admins can use character store submission review tools.

**Architecture:** Keep `/character-store-admin` behind the existing admin login, then add session-based unlock checks to the review API endpoints. The frontend shows a key gate only when the backend reports that `characterStore.adminReviewKey` is configured and the current session is locked.

**Tech Stack:** Express, cookie-session, existing config helper, vanilla browser JavaScript, Jest endpoint/static tests, SillyTavern CSS conventions.

---

## File Structure

- Modify `src/endpoints/character-store.js`: add review key config lookup, unlock status endpoint, unlock endpoint, and unlock middleware for review APIs.
- Modify `public/character-store-admin.html`: add key gate form before the review list.
- Modify `public/scripts/character-store-admin.js`: check unlock status, submit key, and load submissions only after unlock.
- Modify `public/css/character-store-admin.css`: style the key gate.
- Modify `tests/character-store-endpoint.test.js`: endpoint coverage for locked, wrong key, correct key, and empty-key fallback.
- Modify `tests/character-store-ui.test.js`: static coverage for key gate and unlock API calls.
- Modify `default/config.yaml`, `config.yaml`, and `docker/config/config.yaml`: document `characterStore.adminReviewKey`.

### Task 1: Backend RED Tests

- [ ] Add endpoint tests that set `process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = 'review-secret'`, attach a fake `req.session`, and prove admin list is `403` before unlock.
- [ ] Add endpoint tests for wrong key returning `403`.
- [ ] Add endpoint tests for correct key setting session unlock and allowing list.
- [ ] Add endpoint tests proving an empty key preserves current admin-only access.
- [ ] Run `npm --prefix tests run test:unit -- character-store-endpoint.test.js` and confirm the new tests fail because unlock endpoints and middleware do not exist.

### Task 2: Backend Implementation

- [ ] Import `getConfigValue` in `src/endpoints/character-store.js`.
- [ ] Add helpers for configured key lookup, unlock status, constant-time key comparison, and the unlock middleware.
- [ ] Add `POST /submissions/unlock-status` and `POST /submissions/unlock`.
- [ ] Apply the unlock middleware to `list`, `approve`, `reject`, and `preview`.
- [ ] Run `npm --prefix tests run test:unit -- character-store-endpoint.test.js` and confirm the endpoint tests pass.

### Task 3: UI RED Tests

- [ ] Add static tests asserting the admin page contains `store_review_key_gate`, `store_review_key_input`, and `store_review_key_submit`.
- [ ] Add static tests asserting the admin script calls `/api/characters/store/submissions/unlock-status` and `/api/characters/store/submissions/unlock`.
- [ ] Add static tests asserting the admin script checks unlock status before calling `loadSubmissions`.
- [ ] Run `npm --prefix tests run test:unit -- character-store-ui.test.js` and confirm the new tests fail.

### Task 4: UI Implementation

- [ ] Add the key gate form to `public/character-store-admin.html`.
- [ ] Update `public/scripts/character-store-admin.js` so page initialization loads CSRF, checks unlock status, shows the gate if needed, and only then loads submissions.
- [ ] Add CSS for the gate and disabled locked state.
- [ ] Run `npm --prefix tests run test:unit -- character-store-ui.test.js` and confirm the UI tests pass.

### Task 5: Config And Verification

- [ ] Add `characterStore.adminReviewKey: ""` with a short comment to default, local, and docker config files.
- [ ] Run targeted tests for endpoint and UI files.
- [ ] Run eslint on changed source and test files.
- [ ] Run `git diff --check` on changed files.
- [ ] Restart or confirm the local `8001` preview server so the user can open `/character-store-admin`.
