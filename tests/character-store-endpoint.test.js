/* global globalThis */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import multer from 'multer';
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fileURLToPath } from 'node:url';

import { parse, write } from '../src/character-card-parser.js';
import { router as characterStoreRouter } from '../src/endpoints/character-store.js';

const CARD_JSON = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Lyra',
        description: 'Archivist of impossible maps.',
        tags: ['Fantasy', 'Archivist'],
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
const AVATAR_PATH = fileURLToPath(new URL('../public/img/ai4.png', import.meta.url));

async function startServer(app) {
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-character-store-endpoint-test-'));
}

function writeCardPng(filePath, data) {
    const avatar = fs.readFileSync(AVATAR_PATH);
    fs.writeFileSync(filePath, write(avatar, JSON.stringify(data)));
}

describe('character store endpoint', () => {
    let dataRoot = '';
    let charactersDir = '';
    let uploadsDir = '';
    let server = null;
    let baseUrl = '';
    let currentUser = null;
    let currentSession = {};
    let originalReviewKeyEnv = undefined;

    beforeAll(async () => {
        originalReviewKeyEnv = process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY;
        process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = '';
        dataRoot = makeTempRoot();
        charactersDir = path.join(dataRoot, 'default-user', 'characters');
        uploadsDir = path.join(dataRoot, 'uploads');
        const sheetDir = path.join(dataRoot, 'sheet', 'fantasy');
        fs.mkdirSync(sheetDir, { recursive: true });
        fs.mkdirSync(charactersDir, { recursive: true });
        fs.mkdirSync(uploadsDir, { recursive: true });
        writeCardPng(path.join(sheetDir, 'lyra.png'), CARD_JSON);
        fs.writeFileSync(path.join(sheetDir, 'lyra.txt'), 'Mapmaker profile.');
        globalThis.DATA_ROOT = dataRoot;
        currentUser = {
            profile: { handle: 'alice', name: 'Alice', admin: false },
            directories: { characters: charactersDir },
        };

        const app = express();
        app.use(express.json());
        app.use(multer({ dest: uploadsDir }).single('avatar'));
        app.use((req, _res, next) => {
            req.user = currentUser;
            req.session = currentSession;
            next();
        });
        app.use('/api/characters/store', characterStoreRouter);
        const appServer = await startServer(app);
        server = appServer.server;
        baseUrl = appServer.baseUrl;
    });

    beforeEach(() => {
        process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = '';
        currentSession = {};
    });

    afterAll(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        fs.rmSync(dataRoot, { recursive: true, force: true });
        if (originalReviewKeyEnv === undefined) {
            delete process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY;
        } else {
            process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = originalReviewKeyEnv;
        }
    });

    test('lists store cards and imports a selected card', async () => {
        const listResponse = await fetch(`${baseUrl}/api/characters/store/list`, { method: 'POST' });
        const list = await listResponse.json();

        expect(listResponse.status).toBe(200);
        expect(list.tags).toEqual(['Archivist', 'Fantasy']);
        expect(list.cards[0]).toEqual(expect.objectContaining({
            category: 'fantasy',
            name: 'Lyra',
            summary: 'Mapmaker profile.',
        }));

        const importResponse = await fetch(`${baseUrl}/api/characters/store/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_id: list.cards[0].id }),
        });
        const imported = await importResponse.json();

        expect(importResponse.status).toBe(200);
        expect(imported).toEqual(expect.objectContaining({ file_name: 'Lyra.png' }));
        expect(fs.existsSync(path.join(charactersDir, 'Lyra.png'))).toBe(true);
    });

    test('accepts user submissions and lets admins list pending submissions', async () => {
        const formData = new FormData();
        formData.set('name', 'Lyra Submitted');
        formData.set('category', 'Fantasy/User Picks');
        formData.set('tags', 'Fantasy, Submitted');
        formData.set('summary', 'Submitted profile.');
        formData.set('original_confirmed', 'true');
        formData.set('avatar', new Blob([fs.readFileSync(path.join(dataRoot, 'sheet', 'fantasy', 'lyra.png'))], { type: 'image/png' }), 'lyra-upload.png');

        currentUser = {
            profile: { handle: 'alice', name: 'Alice', admin: false },
            directories: { characters: charactersDir },
        };
        const uploadResponse = await fetch(`${baseUrl}/api/characters/store/submissions/upload`, {
            method: 'POST',
            body: formData,
        });
        const uploaded = await uploadResponse.json();

        expect(uploadResponse.status).toBe(200);
        expect(uploaded).toEqual(expect.objectContaining({
            displayName: 'Lyra Submitted',
            category: 'Fantasy/User Picks',
            originalConfirmed: true,
            status: 'pending',
        }));

        currentUser = {
            profile: { handle: 'admin', name: 'Admin', admin: true },
            directories: { characters: charactersDir },
        };
        const listResponse = await fetch(`${baseUrl}/api/characters/store/submissions/list`, {
            method: 'POST',
        });
        const list = await listResponse.json();

        expect(listResponse.status).toBe(200);
        expect(list.submissions).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: uploaded.id, displayName: 'Lyra Submitted' }),
        ]));
    });

    test('rejects user submissions without originality confirmation', async () => {
        const formData = new FormData();
        formData.set('name', 'Lyra Unconfirmed');
        formData.set('category', 'Drafts');
        formData.set('avatar', new Blob([fs.readFileSync(path.join(dataRoot, 'sheet', 'fantasy', 'lyra.png'))], { type: 'image/png' }), 'lyra-unconfirmed.png');

        currentUser = {
            profile: { handle: 'alice', name: 'Alice', admin: false },
            directories: { characters: charactersDir },
        };
        const uploadResponse = await fetch(`${baseUrl}/api/characters/store/submissions/upload`, {
            method: 'POST',
            body: formData,
        });
        const uploaded = await uploadResponse.json();

        expect(uploadResponse.status).toBe(400);
        expect(uploaded).toEqual(expect.objectContaining({
            error: true,
            message: 'Original character card confirmation is required.',
        }));
    });

    test('blocks non-admin users from reviewing submissions', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        currentUser = {
            profile: { handle: 'alice', name: 'Alice', admin: false },
            directories: { characters: charactersDir },
        };

        try {
            const listResponse = await fetch(`${baseUrl}/api/characters/store/submissions/list`, {
                method: 'POST',
            });
            const approveResponse = await fetch(`${baseUrl}/api/characters/store/submissions/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 'missing' }),
            });

            expect(listResponse.status).toBe(403);
            expect(approveResponse.status).toBe(403);
        } finally {
            warnSpy.mockRestore();
        }
    });

    test('requires the configured review key before admins can list submissions', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = 'review-secret';
        currentUser = {
            profile: { handle: 'admin', name: 'Admin', admin: true },
            directories: { characters: charactersDir },
        };

        try {
            const statusResponse = await fetch(`${baseUrl}/api/characters/store/submissions/unlock-status`, {
                method: 'POST',
            });
            const status = await statusResponse.json();
            const listResponse = await fetch(`${baseUrl}/api/characters/store/submissions/list`, {
                method: 'POST',
            });

            expect(statusResponse.status).toBe(200);
            expect(status).toEqual({ required: true, unlocked: false });
            expect(listResponse.status).toBe(403);
        } finally {
            warnSpy.mockRestore();
        }
    });

    test('rejects an incorrect character store review key', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = 'review-secret';
        currentUser = {
            profile: { handle: 'admin', name: 'Admin', admin: true },
            directories: { characters: charactersDir },
        };

        try {
            const unlockResponse = await fetch(`${baseUrl}/api/characters/store/submissions/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'wrong-secret' }),
            });
            const listResponse = await fetch(`${baseUrl}/api/characters/store/submissions/list`, {
                method: 'POST',
            });

            expect(unlockResponse.status).toBe(403);
            expect(listResponse.status).toBe(403);
        } finally {
            warnSpy.mockRestore();
        }
    });

    test('unlocks the configured review key for the current admin session', async () => {
        process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = 'review-secret';
        currentUser = {
            profile: { handle: 'admin', name: 'Admin', admin: true },
            directories: { characters: charactersDir },
        };

        const unlockResponse = await fetch(`${baseUrl}/api/characters/store/submissions/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'review-secret' }),
        });
        const unlock = await unlockResponse.json();
        const statusResponse = await fetch(`${baseUrl}/api/characters/store/submissions/unlock-status`, {
            method: 'POST',
        });
        const status = await statusResponse.json();
        const listResponse = await fetch(`${baseUrl}/api/characters/store/submissions/list`, {
            method: 'POST',
        });

        expect(unlockResponse.status).toBe(200);
        expect(unlock).toEqual({ required: true, unlocked: true });
        expect(status).toEqual({ required: true, unlocked: true });
        expect(listResponse.status).toBe(200);
    });

    test('keeps admin review APIs available when no review key is configured', async () => {
        process.env.SILLYTAVERN_CHARACTERSTORE_ADMINREVIEWKEY = '';
        currentUser = {
            profile: { handle: 'admin', name: 'Admin', admin: true },
            directories: { characters: charactersDir },
        };

        const statusResponse = await fetch(`${baseUrl}/api/characters/store/submissions/unlock-status`, {
            method: 'POST',
        });
        const status = await statusResponse.json();
        const listResponse = await fetch(`${baseUrl}/api/characters/store/submissions/list`, {
            method: 'POST',
        });

        expect(statusResponse.status).toBe(200);
        expect(status).toEqual({ required: false, unlocked: true });
        expect(listResponse.status).toBe(200);
    });

    test('lets admins approve a submission with an adjusted category', async () => {
        const formData = new FormData();
        formData.set('name', 'Lyra Draft');
        formData.set('category', 'Drafts');
        formData.set('tags', 'Draft');
        formData.set('summary', 'Draft summary.');
        formData.set('original_confirmed', 'true');
        formData.set('avatar', new Blob([fs.readFileSync(path.join(dataRoot, 'sheet', 'fantasy', 'lyra.png'))], { type: 'image/png' }), 'lyra-draft.png');

        currentUser = {
            profile: { handle: 'alice', name: 'Alice', admin: false },
            directories: { characters: charactersDir },
        };
        const uploadResponse = await fetch(`${baseUrl}/api/characters/store/submissions/upload`, {
            method: 'POST',
            body: formData,
        });
        const uploaded = await uploadResponse.json();

        currentUser = {
            profile: { handle: 'admin', name: 'Admin', admin: true },
            directories: { characters: charactersDir },
        };
        const approveResponse = await fetch(`${baseUrl}/api/characters/store/submissions/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: uploaded.id,
                name: 'Lyra Reviewed',
                category: 'Reviewed/Featured',
                tags: 'Reviewed, Featured',
                summary: 'Reviewed summary.',
            }),
        });
        const approved = await approveResponse.json();

        expect(approveResponse.status).toBe(200);
        expect(approved).toEqual(expect.objectContaining({
            status: 'approved',
            displayName: 'Lyra Reviewed',
            category: 'Reviewed/Featured',
            publishedRelativePath: 'Reviewed/Featured/Lyra Reviewed.png',
        }));
        expect(fs.existsSync(path.join(dataRoot, 'sheet', 'Reviewed', 'Featured', 'Lyra Reviewed.png'))).toBe(true);
    });

    test('lets admins import pending submissions into their own character library for detailed review', async () => {
        const formData = new FormData();
        formData.set('name', 'Lyra Inspect');
        formData.set('category', 'Drafts');
        formData.set('tags', 'Draft');
        formData.set('summary', 'Needs detailed inspection.');
        formData.set('original_confirmed', 'true');
        formData.set('avatar', new Blob([fs.readFileSync(path.join(dataRoot, 'sheet', 'fantasy', 'lyra.png'))], { type: 'image/png' }), 'lyra-inspect.png');

        currentUser = {
            profile: { handle: 'alice', name: 'Alice', admin: false },
            directories: { characters: charactersDir },
        };
        const uploadResponse = await fetch(`${baseUrl}/api/characters/store/submissions/upload`, {
            method: 'POST',
            body: formData,
        });
        const uploaded = await uploadResponse.json();

        currentUser = {
            profile: { handle: 'admin', name: 'Admin', admin: true },
            directories: { characters: charactersDir },
        };
        const importResponse = await fetch(`${baseUrl}/api/characters/store/submissions/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: uploaded.id, name: 'Lyra Inspect Copy' }),
        });
        const imported = await importResponse.json();
        const listResponse = await fetch(`${baseUrl}/api/characters/store/submissions/list`, {
            method: 'POST',
        });
        const list = await listResponse.json();
        const importedPath = path.join(charactersDir, imported.file_name);
        const importedCard = JSON.parse(await parse(importedPath, 'png'));

        expect(importResponse.status).toBe(200);
        expect(imported).toEqual(expect.objectContaining({ file_name: 'Lyra Inspect Copy.png' }));
        expect(fs.existsSync(importedPath)).toBe(true);
        expect(importedCard.data.name).toBe('Lyra Inspect Copy');
        expect(importedCard.data.character_book).toEqual(expect.objectContaining({ name: 'Lyra World' }));
        expect(list.submissions).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: uploaded.id, status: 'pending' }),
        ]));
    });
});
