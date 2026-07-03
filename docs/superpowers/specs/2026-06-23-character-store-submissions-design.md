# Character Store Submissions Design

## Goal

Let registered SillyTavern users submit their own character cards from the character store, then let admins review, edit metadata, and publish approved cards into the public character card repository.

## Current Context

- The public character store is backed by files under `data/sheet`.
- The store scanner indexes `.png` and `.json` cards, reads matching `.txt` summaries, reads matching `.tag.txt` tag sidecars, and writes a SQLite index for listing.
- The existing store API lives under `POST /api/characters/store/list`, `POST /api/characters/store/import`, and `GET /api/characters/store/preview/:cardId`.
- User accounts and public registration already exist. Authenticated API routes have `request.user`; admin-only routes can use `requireAdminMiddleware`.
- The server has a global `multer(...).single('avatar')` upload middleware for authenticated routes, so store uploads can reuse the existing `avatar` file field.

## User Flow

Users open the character store and choose the new upload action.

The upload form accepts:

- Character card file: `.png` or `.json`.
- Display name.
- Category.
- Tags.
- Summary.

The user chooses the category before upload. Categories may be nested with `/`. The server normalizes unsafe path segments and falls back to `user-submissions` if the input is empty.

On submit, the server validates that the uploaded file is a readable character card. Valid submissions go to a pending review area and do not appear in the public store. The UI shows a concise success message telling the user that the card is waiting for review.

## Admin Flow

Admins open a new page at `/character-store-admin`.

The page lists pending submissions with:

- Preview image.
- Submitted display name.
- Submitted category.
- Submitted tags.
- Submitted summary.
- Uploader handle and submit time.
- Editable name, category, tags, and summary fields.
- Approve and reject actions.

When approving, the admin can keep the user-selected category or change it. The approved card is published to `data/sheet/<final-category>/`, sidecars are written beside it, and the public store index is refreshed. Rejecting a card marks it rejected and keeps it out of the public store.

## Storage Layout

Submission storage lives outside the public store so pending cards cannot be indexed accidentally.

```text
data/
  character-store-submissions/
    pending/
      <submission-id>/
        card.png
        metadata.json
    approved/
      <submission-id>/
        card.png
        metadata.json
    rejected/
      <submission-id>/
        card.png
        metadata.json
```

`metadata.json` shape:

```json
{
  "id": "uuid",
  "status": "pending",
  "submittedAt": "2026-06-23T00:00:00.000Z",
  "submittedBy": {
    "handle": "alice",
    "name": "Alice"
  },
  "originalFileName": "lyra.png",
  "fileName": "card.png",
  "format": "png",
  "cardName": "Lyra",
  "displayName": "Lyra the Archivist",
  "category": "fantasy/maps",
  "tags": ["Fantasy", "Archivist"],
  "summary": "Mapmaker profile.",
  "reviewedAt": null,
  "reviewedBy": null,
  "rejectionReason": "",
  "publishedRelativePath": ""
}
```

Approved and rejected metadata preserve the review result. Approved metadata stores the final public relative path.

## Backend API

Add submission APIs under the existing character store router.

```text
POST /api/characters/store/submissions/upload
POST /api/characters/store/submissions/list
POST /api/characters/store/submissions/approve
POST /api/characters/store/submissions/reject
GET  /api/characters/store/submissions/preview/:submissionId
```

`upload` is available to any authenticated user. It accepts multipart form data with:

- `avatar`: uploaded `.png` or `.json` card file.
- `name`: display name.
- `category`: requested category.
- `tags`: comma or newline separated tags.
- `summary`: short summary.

`list`, `approve`, and `reject` are protected by `requireAdminMiddleware`.

`preview` is protected by `requireAdminMiddleware`. PNG submissions return the uploaded PNG. JSON submissions return the default avatar, matching the current public store preview behavior for JSON cards.

## Publishing Rules

Approving a submission:

1. Reloads pending metadata and validates the submission is still pending.
2. Applies admin-provided final metadata.
3. Normalizes the category and tags.
4. Chooses a unique public filename in `data/sheet/<category>`.
5. Rewrites the card's embedded character name to match the final display name.
6. Writes `.txt` summary and `.tag.txt` tag sidecars.
7. Moves the submission folder from `pending` to `approved`.
8. Refreshes the public character store index.

Rejecting a submission:

1. Reloads pending metadata.
2. Records reviewer, review time, and rejection reason.
3. Moves the submission folder from `pending` to `rejected`.
4. Does not write anything into `data/sheet`.

## Validation And Safety

- Only `.png` and `.json` files are accepted.
- PNG cards must contain readable character metadata.
- JSON cards must parse as JSON.
- Uploaded files are copied into controlled submission folders and the temporary upload is removed.
- Category segments are sanitized and cannot escape `data/sheet`.
- Public filenames are sanitized and made unique.
- Tags are trimmed, deduplicated, and empty tags are ignored.
- Failed uploads remove temporary files and do not leave partial pending submissions.

## Frontend

Character store modal changes:

- Add an upload icon button near refresh.
- Add a compact upload panel inside the character store modal.
- File input accepts `.png,.json`.
- Category is a text input so users can create or reuse categories.
- Tags are entered as comma or newline separated text.
- Submit uses `FormData` and `getRequestHeaders({ omitContentType: true })`.

Admin page:

- Add `public/character-store-admin.html`.
- Add `public/scripts/character-store-admin.js`.
- Add `public/css/character-store-admin.css`.
- The route `/character-store-admin` serves the HTML only to admins.
- The page uses existing Font Awesome icons and SillyTavern visual conventions.

## Error Handling

Expected upload errors:

- `400`: missing file, unsupported format, invalid character card, or missing display name.
- `403`: unauthenticated or unauthorized.
- `500`: unexpected server failure.

Expected admin errors:

- `400`: missing submission id or invalid action data.
- `403`: non-admin access.
- `404`: submission not found.
- `409`: submission is no longer pending.
- `500`: unexpected server failure.

The user store modal displays upload errors with `toastr.error`. The admin page displays inline errors and keeps the current list visible.

## Tests

Backend core tests:

- Uploading a valid PNG creates a pending submission with metadata and removes the temp upload.
- Uploading an invalid card fails without creating a submission.
- Approving a submission writes the public card, summary sidecar, tag sidecar, and refreshes the store list.
- Rejecting a submission moves it to rejected and does not publish it.
- Categories and filenames cannot escape the store root.

Endpoint tests:

- Authenticated users can upload submissions.
- Admins can list pending submissions.
- Admins can approve with an adjusted category.
- Non-admin users cannot list or approve submissions.

Frontend/static tests:

- The store modal exposes an upload entry point and posts multipart data to the upload endpoint.
- The admin HTML loads the admin script and contains the review surface.
- The server has an authenticated admin route for `/character-store-admin`.

Verification commands:

```bash
npm --prefix tests run test:unit -- character-store-submissions.test.js character-store-endpoint.test.js character-store-ui.test.js
npm --prefix tests run lint -- character-store-submissions.test.js character-store-endpoint.test.js character-store-ui.test.js
npm run lint -- src/character-store-submissions.js src/endpoints/character-store.js src/server-main.js public/scripts/character-store.js public/scripts/character-store-admin.js
git diff --check -- src/character-store-submissions.js src/endpoints/character-store.js src/server-main.js public/index.html public/character-store-admin.html public/scripts/character-store.js public/scripts/character-store-admin.js public/css/character-store.css public/css/character-store-admin.css tests/character-store-submissions.test.js tests/character-store-endpoint.test.js tests/character-store-ui.test.js docs/superpowers/specs/2026-06-23-character-store-submissions-design.md
```
