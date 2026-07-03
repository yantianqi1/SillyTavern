import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { parse, write } from '../src/character-card-parser.js';
import { scanCharacterStore } from '../src/character-card-store.js';
import {
    approveStoreSubmission,
    createStoreSubmission,
    importStoreSubmissionToLibrary,
    listPendingStoreSubmissions,
    rejectStoreSubmission,
} from '../src/character-store-submissions.js';

const AVATAR_PATH = fileURLToPath(new URL('../public/img/ai4.png', import.meta.url));
const CARD_JSON = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Lyra',
        description: 'Archivist of impossible maps.',
        tags: ['Fantasy'],
        character_book: {
            name: 'Lyra World',
            entries: [
                {
                    keys: ['atlas'],
                    content: 'Secret atlas lore.',
                },
            ],
        },
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
                tags: 'Fantasy, Archivist\nFeatured',
                summary: 'Mapmaker profile.',
                original_confirmed: 'true',
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
            originalConfirmed: true,
        }));
        await expect(listPendingStoreSubmissions({ dataRoot })).resolves.toEqual([
            expect.objectContaining({ id: submission.id, submittedBy: { handle: 'alice', name: 'Alice' } }),
        ]);
    });

    test('normalizes user-friendly Chinese tag separators', async () => {
        const submission = await createStoreSubmission({
            dataRoot,
            uploadPath,
            originalFileName: 'Lyra Upload.png',
            user: { handle: 'alice', name: 'Alice' },
            fields: {
                name: 'Lyra Public',
                category: '综合',
                tags: '古风，女主、甜宠；世界书完整\n古风',
                summary: 'Mapmaker profile.',
            },
        });

        expect(submission).toEqual(expect.objectContaining({
            category: '综合',
            tags: ['古风', '女主', '甜宠', '世界书完整'],
        }));
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
        expect(fs.readFileSync(path.join(dataRoot, 'sheet', 'Featured', 'Maps', 'Lyra Curated.tag.txt'), 'utf8')).toBe('Curated\nArchivist');

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

    test('imports a pending submission into a reviewer character library without changing review status', async () => {
        const submission = await createStoreSubmission({
            dataRoot,
            uploadPath,
            originalFileName: 'lyra.png',
            user: { handle: 'alice', name: 'Alice' },
            fields: { name: 'Lyra Public', category: 'Fantasy' },
        });
        const charactersDir = path.join(dataRoot, 'admin', 'characters');

        const imported = await importStoreSubmissionToLibrary({
            dataRoot,
            submissionId: submission.id,
            charactersDir,
            fields: { name: 'Lyra Review Copy' },
        });
        const importedPath = path.join(charactersDir, imported.fileName);
        const importedCard = JSON.parse(await parse(importedPath, 'png'));

        expect(imported.fileName).toBe('Lyra Review Copy.png');
        expect(fs.existsSync(importedPath)).toBe(true);
        expect(importedCard.data.name).toBe('Lyra Review Copy');
        expect(importedCard.data.character_book).toEqual(expect.objectContaining({ name: 'Lyra World' }));
        await expect(listPendingStoreSubmissions({ dataRoot })).resolves.toEqual([
            expect.objectContaining({ id: submission.id, status: 'pending' }),
        ]);
    });
});
