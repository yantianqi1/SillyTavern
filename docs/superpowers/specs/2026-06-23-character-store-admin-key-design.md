# Character Store Admin Review Key Design

## Goal

Add a second gate to the character store submission review page and review APIs. Admin users must enter a server-side review key before they can list, preview, approve, or reject submitted character cards.

## Chosen Approach

Use the existing admin login as the first gate, then add a single review key unlock stored on the current session.

The review key is configured in `config.yaml`:

```yaml
characterStore:
  adminReviewKey: ""
```

When the value is empty or missing, the current admin-only behavior remains unchanged. When the value is non-empty, admins must unlock the review tools once per browser session. The key is never embedded in frontend code.

## Backend Flow

- `POST /api/characters/store/submissions/unlock-status` returns whether a key is required and whether the current session is already unlocked.
- `POST /api/characters/store/submissions/unlock` accepts `{ "key": "..." }`.
- Correct keys set `request.session.characterStoreAdminUnlocked = true`.
- Wrong keys return `403`.
- Non-admin users still receive `403` before key checks.
- `list`, `approve`, `reject`, and `preview` require admin permission plus the session unlock when a key is configured.

## Frontend Flow

The page at `/character-store-admin` is still served only to admins. After loading CSRF, the admin script asks the server for unlock status.

If a key is required and the session is locked, the page shows a compact key form and does not request pending submissions. Submitting the correct key hides the gate and loads the review list. Refresh, approve, reject, and preview work only after the session is unlocked.

## Security Notes

This is a practical extra barrier, not a replacement for real admin authentication. The key is checked server-side, protected review APIs share the same gate, and the session flag is stored in the existing HTTP-only session cookie. Keeping the key empty deliberately disables the extra gate for installs that do not need it.

## Tests

- Endpoint tests cover locked admin sessions, wrong keys, correct keys, and empty-key fallback.
- Static UI tests cover the key gate markup, unlock endpoint usage, and unlock-status check before listing submissions.
