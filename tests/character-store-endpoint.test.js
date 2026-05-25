/* global globalThis */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { fileURLToPath } from 'node:url';

import { write } from '../src/character-card-parser.js';
import { router as characterStoreRouter } from '../src/endpoints/character-store.js';

const CARD_JSON = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Lyra',
        description: 'Archivist of impossible maps.',
        tags: ['Fantasy', 'Archivist'],
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
    let server = null;
    let baseUrl = '';

    beforeAll(async () => {
        dataRoot = makeTempRoot();
        charactersDir = path.join(dataRoot, 'default-user', 'characters');
        const sheetDir = path.join(dataRoot, 'sheet', 'fantasy');
        fs.mkdirSync(sheetDir, { recursive: true });
        fs.mkdirSync(charactersDir, { recursive: true });
        writeCardPng(path.join(sheetDir, 'lyra.png'), CARD_JSON);
        fs.writeFileSync(path.join(sheetDir, 'lyra.txt'), 'Mapmaker profile.');
        globalThis.DATA_ROOT = dataRoot;

        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { directories: { characters: charactersDir } };
            next();
        });
        app.use('/api/characters/store', characterStoreRouter);
        const appServer = await startServer(app);
        server = appServer.server;
        baseUrl = appServer.baseUrl;
    });

    afterAll(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        fs.rmSync(dataRoot, { recursive: true, force: true });
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
});
