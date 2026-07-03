# Character Store Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user character card submissions and admin review publishing for the SillyTavern character store.

**Architecture:** Store pending submissions outside `data/sheet`, then publish approved cards into `data/sheet/<category>` with summary and tag sidecars. Reuse the existing character store router, scanner, user session data, `requireAdminMiddleware`, and global `avatar` upload field.

**Tech Stack:** Express, Node fs/path/crypto, existing character card parser, sanitize-filename, jQuery, Font Awesome, Jest, existing SillyTavern CSS conventions.

---

## File Structure

- Create `src/character-store-submissions.js`: submission storage, validation, metadata normalization, approve/reject publishing.
- Modify `src/endpoints/character-store.js`: upload/list/approve/reject/preview submission endpoints.
- Modify `src/server-main.js`: authenticated admin HTML route.
- Modify `public/index.html`: upload button and upload panel in the character store modal.
- Modify `public/scripts/character-store.js`: upload panel behavior and multipart upload request.
- Modify `public/css/character-store.css`: upload panel styles.
- Create `public/character-store-admin.html`: admin review page shell.
- Create `public/scripts/character-store-admin.js`: admin list, edit, approve, reject behavior.
- Create `public/css/character-store-admin.css`: admin page layout.
- Create `tests/character-store-submissions.test.js`: core submission behavior.
- Modify `tests/character-store-endpoint.test.js`: endpoint behavior and admin authorization.
- Modify `tests/character-store-ui.test.js`: static UI coverage.

### Task 1: Core Submission Tests

**Files:**
- Create: `tests/character-store-submissions.test.js`

- [ ] **Step 1: Write failing core tests**

Create tests that use temporary directories, `write()` from `src/character-card-parser.js`, and the planned API from `src/character-store-submissions.js`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { write } from '../src/character-card-parser.js';
import {
    approveStoreSubmission,
    createStoreSubmission,
    listPendingStoreSubmissions,
    rejectStoreSubmission,
} from '../src/character-store-submissions.js';
import { scanCharacterStore } from '../src/character-card-store.js';

const AVATAR_PATH = fileURLToPath(new URL('../public/img/ai4.png', import.meta.url));
const CARD_JSON = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Lyra',
        description: 'Archivist of impossible maps.',
        tags: ['Fantasy'],
    },
};

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-store-submissions-'));
}

function writeCardPng(filePath, data = CARD_JSON) {
    const avatar = fs.readFileSync(AVATAR_PATH);
    fs.writeFileSync(filePath, write(avatar, JSON.stringify(data)));
}

describe('character store submissions', () => {
    let dataRoot = '';
    let uploadPath = '';

    beforeEach(() => {
        dataRoot = makeTempRoot();
        uploadPath = path.join(dataRoot, 'upload.png');
        writeCardPng(uploadPath);
    });

    afterEach(() => {
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    test('creates a pending submission with normalized user metadata', async () => {
        const submission = await createStoreSubmission({
            dataRoot,
            uploadPath,
            originalFileName: 'Lyra Upload.png',
            user: { handle: 'alice', name: 'Alice' },
            fields: {
                name: 'Lyra Public',
                category: 'Fantasy/Maps',
                tags: 'Fantasy, Archivist\\nFeatured',
                summary: 'Mapmaker profile.',
            },
        });

        expect(fs.existsSync(uploadPath)).toBe(false);
        expect(submission).toEqual(expect.objectContaining({
            status: 'pending',
            displayName: 'Lyra Public',
            category: 'Fantasy/Maps',
            tags: ['Fantasy', 'Archivist', 'Featured'],
            summary: 'Mapmaker profile.',
            cardName: 'Lyra',
        }));
        expect(listPendingStoreSubmissions({ dataRoot })).resolves.toEqual([
            expect.objectContaining({ id: submission.id, submittedBy: { handle: 'alice', name: 'Alice' } }),
        ]);
    });

    test('rejects invalid card files without creating pending metadata', async () => {
        fs.writeFileSync(uploadPath, 'not a card');

        await expect(createStoreSubmission({
            dataRoot,
            uploadPath,
            originalFileName: 'broken.png',
            user: { handle: 'alice', name: 'Alice' },
            fields: { name: 'Broken', category: 'bad' },
        })).rejects.toThrow('Invalid character card');

        expect(fs.existsSync(path.join(dataRoot, 'character-store-submissions', 'pending'))).toBe(false);
    });

    test('approves a pending submission into the public sheet with adjusted metadata', async () => {
        const submission = await createStoreSubmission({
            dataRoot,
            uploadPath,
            originalFileName: 'lyra.png',
            user: { handle: 'alice', name: 'Alice' },
            fields: { name: 'Lyra Public', category: 'Fantasy', tags: 'Fantasy', summary: 'Original summary.' },
        });

        const approved = await approveStoreSubmission({
            dataRoot,
            submissionId: submission.id,
            reviewer: { handle: 'admin', name: 'Admin' },
            fields: {
                name: 'Lyra Curated',
                category: 'Featured/Maps',
                tags: 'Curated, Archivist',
                summary: 'Curated mapmaker profile.',
            },
        });

        expect(approved.status).toBe('approved');
        expect(approved.publishedRelativePath).toBe('Featured/Maps/Lyra Curated.png');
        expect(fs.existsSync(path.join(dataRoot, 'sheet', approved.publishedRelativePath))).toBe(true);
        expect(fs.readFileSync(path.join(dataRoot, 'sheet', 'Featured', 'Maps', 'Lyra Curated.txt'), 'utf8')).toBe('Curated mapmaker profile.');
        expect(fs.readFileSync(path.join(dataRoot, 'sheet', 'Featured', 'Maps', 'Lyra Curated.tag.txt'), 'utf8')).toBe('Curated\\nArchivist');

        const store = await scanCharacterStore({ sheetRoot: path.join(dataRoot, 'sheet') });
        expect(store.cards[0]).toEqual(expect.objectContaining({
            name: 'Lyra Curated',
            category: 'Featured/Maps',
            tags: ['Fantasy', 'Curated', 'Archivist'],
        }));
    });

    test('rejects a submission without publishing it', async () => {
        const submission = await createStoreSubmission({
            dataRoot,
            uploadPath,
            originalFileName: 'lyra.png',
            user: { handle: 'alice', name: 'Alice' },
            fields: { name: 'Lyra Public', category: 'Fantasy' },
        });

        const rejected = await rejectStoreSubmission({
            dataRoot,
            submissionId: submission.id,
            reviewer: { handle: 'admin', name: 'Admin' },
            reason: 'Needs edits.',
        });

        expect(rejected).toEqual(expect.objectContaining({
            status: 'rejected',
            rejectionReason: 'Needs edits.',
            reviewedBy: { handle: 'admin', name: 'Admin' },
        }));
        expect(fs.existsSync(path.join(dataRoot, 'sheet'))).toBe(false);
    });
});
```

- [ ] **Step 2: Run core tests to verify RED**

Run:

```bash
npm --prefix tests run test:unit -- character-store-submissions.test.js
```

Expected: FAIL because `src/character-store-submissions.js` does not exist.

### Task 2: Core Submission Implementation

**Files:**
- Create: `src/character-store-submissions.js`

- [ ] **Step 1: Implement the submission module**

Implement exported functions:

```js
export async function createStoreSubmission({ dataRoot, uploadPath, originalFileName, user, fields }) {}
export async function listPendingStoreSubmissions({ dataRoot }) {}
export async function approveStoreSubmission({ dataRoot, submissionId, reviewer, fields }) {}
export async function rejectStoreSubmission({ dataRoot, submissionId, reviewer, reason }) {}
export async function getStoreSubmissionPreviewPath({ dataRoot, submissionId }) {}
```

Use these rules:

- Store files below `dataRoot/character-store-submissions`.
- Use `crypto.randomUUID()` for submission ids.
- Accept only `.png` and `.json`.
- Read PNG metadata with `parse(uploadPath, 'png')`.
- Read JSON with `fsPromises.readFile(uploadPath, 'utf8')`.
- Parse the card JSON to validate it.
- Use `sanitize-filename` for filename and category path segments.
- Write final public cards into `dataRoot/sheet/<category>`.
- Rewrite the embedded card name to the final display name before publishing.
- Write summary and tag sidecars beside approved cards.
- Move pending submission directories to `approved` or `rejected`.

- [ ] **Step 2: Run core tests to verify GREEN**

Run:

```bash
npm --prefix tests run test:unit -- character-store-submissions.test.js
```

Expected: PASS.

### Task 3: Submission Endpoint Tests

**Files:**
- Modify: `tests/character-store-endpoint.test.js`

- [ ] **Step 1: Write failing endpoint tests**

Extend the existing endpoint test server with `multer({ dest: uploadsPath }).single('avatar')` and user profiles. Add tests for:

- `POST /api/characters/store/submissions/upload` accepts a user upload.
- `POST /api/characters/store/submissions/list` returns pending submissions for admins.
- Non-admin list or approve requests return `403`.
- Admin approve can adjust the category and publish to the public store.

- [ ] **Step 2: Run endpoint tests to verify RED**

Run:

```bash
npm --prefix tests run test:unit -- character-store-endpoint.test.js
```

Expected: FAIL because submission endpoints are not registered.

### Task 4: Submission Endpoints

**Files:**
- Modify: `src/endpoints/character-store.js`

- [ ] **Step 1: Add route imports**

Import:

```js
import { requireAdminMiddleware } from '../users.js';
import {
    approveStoreSubmission,
    createStoreSubmission,
    getStoreSubmissionPreviewPath,
    listPendingStoreSubmissions,
    rejectStoreSubmission,
} from '../character-store-submissions.js';
```

- [ ] **Step 2: Add routes**

Add routes:

- `POST /submissions/upload`
- `POST /submissions/list`, admin only
- `POST /submissions/approve`, admin only
- `POST /submissions/reject`, admin only
- `GET /submissions/preview/:submissionId`, admin only

All JSON responses should use `{ error: true, message }` on failure, matching existing character store endpoint style.

- [ ] **Step 3: Refresh store index after approval**

After successful approval, call `scanCharacterStore({ sheetRoot: getCharacterStoreRoot() })` so the approved card is visible immediately.

- [ ] **Step 4: Run endpoint tests to verify GREEN**

Run:

```bash
npm --prefix tests run test:unit -- character-store-endpoint.test.js
```

Expected: PASS.

### Task 5: Store Upload UI Tests

**Files:**
- Modify: `tests/character-store-ui.test.js`

- [ ] **Step 1: Write failing static tests**

Add expectations that:

- `public/index.html` contains `id="character_store_upload"`.
- `public/index.html` contains `id="character_store_upload_panel"`.
- `public/scripts/character-store.js` posts to `/api/characters/store/submissions/upload`.
- The script uses `FormData`.
- `public/css/character-store.css` contains `.character_store_upload_panel`.

- [ ] **Step 2: Run UI tests to verify RED**

Run:

```bash
npm --prefix tests run test:unit -- character-store-ui.test.js
```

Expected: FAIL because upload UI is not present.

### Task 6: Store Upload UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/scripts/character-store.js`
- Modify: `public/css/character-store.css`

- [ ] **Step 1: Add upload markup**

Add an upload icon button in `.character_store_showcase_actions`, a hidden upload panel inside the modal, and fields for file, name, category, tags, and summary.

- [ ] **Step 2: Add upload behavior**

In `public/scripts/character-store.js`, add:

- `STORE_UPLOAD_ENDPOINT`.
- Click handlers for opening/closing the upload panel.
- Submit handler that builds `FormData`, appends `avatar`, `name`, `category`, `tags`, and `summary`.
- `fetch(STORE_UPLOAD_ENDPOINT, { method: 'POST', headers: dependencies.getRequestHeaders({ omitContentType: true }), body: formData })`.
- On success, reset the form and show `toastr.success`.

- [ ] **Step 3: Add upload panel CSS**

Style the panel as an in-modal form with compact controls, no nested card shells, stable button sizes, and mobile-safe wrapping.

- [ ] **Step 4: Run UI tests to verify GREEN**

Run:

```bash
npm --prefix tests run test:unit -- character-store-ui.test.js
```

Expected: PASS.

### Task 7: Admin Page Tests

**Files:**
- Modify: `tests/character-store-ui.test.js`

- [ ] **Step 1: Write failing admin static tests**

Add tests that read `public/character-store-admin.html`, `public/scripts/character-store-admin.js`, `public/css/character-store-admin.css`, and `src/server-main.js`, then expect:

- Admin HTML loads `scripts/character-store-admin.js`.
- Admin HTML contains `id="store_submission_list"`.
- Admin script calls `/api/characters/store/submissions/list`.
- Admin script calls `/api/characters/store/submissions/approve`.
- Admin script calls `/api/characters/store/submissions/reject`.
- Server main contains `'/character-store-admin'`.

- [ ] **Step 2: Run UI tests to verify RED**

Run:

```bash
npm --prefix tests run test:unit -- character-store-ui.test.js
```

Expected: FAIL because admin page files and route do not exist.

### Task 8: Admin Page Implementation

**Files:**
- Create: `public/character-store-admin.html`
- Create: `public/scripts/character-store-admin.js`
- Create: `public/css/character-store-admin.css`
- Modify: `src/server-main.js`

- [ ] **Step 1: Add protected admin route**

Import `requireAdminMiddleware` in `src/server-main.js` and add:

```js
app.get('/character-store-admin', requireAdminMiddleware, cacheBuster.middleware, (_request, response) => {
    return response.sendFile('character-store-admin.html', { root: path.join(serverDirectory, 'public') });
});
```

Place it after `app.use(requireLoginMiddleware)`.

- [ ] **Step 2: Create admin HTML**

Create an HTML page that loads the existing fonts, Font Awesome CSS, `style.css`, and `css/character-store-admin.css`, then renders a toolbar, status area, and `#store_submission_list`.

- [ ] **Step 3: Create admin script**

The script should:

- Fetch CSRF token from `/csrf-token`.
- Build request headers.
- Load pending submissions from `/api/characters/store/submissions/list`.
- Render each submission with image preview, editable name/category/tags/summary inputs, approve button, and reject button.
- Approve by posting final metadata.
- Reject by prompting for a reason and posting it.
- Reload the list after each successful action.

- [ ] **Step 4: Create admin CSS**

Use a restrained operational layout: fixed toolbar, responsive grid list, compact inputs, icon buttons, and no nested card shells.

- [ ] **Step 5: Run UI tests to verify GREEN**

Run:

```bash
npm --prefix tests run test:unit -- character-store-ui.test.js
```

Expected: PASS.

### Task 9: Final Verification

**Files:**
- All changed files above.

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
npm --prefix tests run test:unit -- character-store-submissions.test.js character-store-endpoint.test.js character-store-ui.test.js
```

Expected: PASS.

- [ ] **Step 2: Run lint for touched code**

Run:

```bash
npm run lint -- src/character-store-submissions.js src/endpoints/character-store.js src/server-main.js public/scripts/character-store.js public/scripts/character-store-admin.js
```

Expected: PASS.

- [ ] **Step 3: Run diff check**

Run:

```bash
git diff --check -- src/character-store-submissions.js src/endpoints/character-store.js src/server-main.js public/index.html public/character-store-admin.html public/scripts/character-store.js public/scripts/character-store-admin.js public/css/character-store.css public/css/character-store-admin.css tests/character-store-submissions.test.js tests/character-store-endpoint.test.js tests/character-store-ui.test.js docs/superpowers/specs/2026-06-23-character-store-submissions-design.md docs/superpowers/plans/2026-06-23-character-store-submissions.md
```

Expected: no output and exit code 0.
