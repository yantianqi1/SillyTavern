import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { Buffer } from 'node:buffer';

import { parse, write } from '../src/character-card-parser.js';
import {
    getStoreCardPreviewPath,
    importStoreCard,
    scanCharacterStore,
} from '../src/character-card-store.js';

const CARD_JSON = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Astra',
        description: 'A navigator from the outer rim.',
        tags: ['Sci-Fi', 'Navigator'],
        creator: 'Test Suite',
        character_version: '1.0.0',
    },
};
const AVATAR_PATH = fileURLToPath(new URL('../public/img/ai4.png', import.meta.url));

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-character-store-test-'));
}

function writeCardPng(filePath, data) {
    const avatar = fs.readFileSync(AVATAR_PATH);
    fs.writeFileSync(filePath, write(avatar, JSON.stringify(data)));
}

describe('character card store', () => {
    let tempRoot = '';
    let sheetRoot = '';
    let charactersDir = '';

    beforeEach(() => {
        tempRoot = makeTempRoot();
        sheetRoot = path.join(tempRoot, 'sheet');
        charactersDir = path.join(tempRoot, 'characters');
        fs.mkdirSync(path.join(sheetRoot, 'space', 'pilots'), { recursive: true });
        fs.mkdirSync(charactersDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    test('scans nested sheet folders with tags and matching txt summaries', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        writeCardPng(cardPath, CARD_JSON);
        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'astra.txt'), 'AI-written intro.');

        const result = await scanCharacterStore({ sheetRoot });

        expect(result.tags).toEqual(['Navigator', 'Sci-Fi']);
        expect(result.categories).toEqual(['space/pilots']);
        expect(result.cards).toEqual([
            expect.objectContaining({
                category: 'space/pilots',
                format: 'png',
                name: 'Astra',
                relativePath: 'space/pilots/astra.png',
                summary: 'AI-written intro.',
                tags: ['Sci-Fi', 'Navigator'],
            }),
        ]);
        expect(result.cards[0].id).toBeTruthy();
    });

    test('merges card tags with matching tag sidecar files', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        writeCardPng(cardPath, {
            ...CARD_JSON,
            data: { ...CARD_JSON.data, tags: ['Sci-Fi', 'Navigator', 'Sci-Fi'] },
        });
        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'astra.tag.txt'), 'Navigator\nSFW\n科幻\nSFW\n');

        const result = await scanCharacterStore({ sheetRoot });

        expect(result.cards[0]).toEqual(expect.objectContaining({
            tags: ['Sci-Fi', 'Navigator', 'SFW', '科幻'],
        }));
        expect(result.tags).toEqual(['Navigator', 'Sci-Fi', 'SFW', '科幻']);
    });

    test('refreshes indexed tags when a tag sidecar changes', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        const dbPath = path.join(tempRoot, 'character-store.sqlite');
        writeCardPng(cardPath, CARD_JSON);
        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'astra.tag.txt'), 'SFW\n');
        await scanCharacterStore({ sheetRoot, dbPath });

        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'astra.tag.txt'), 'NSFW\nDominant\n');
        const result = await scanCharacterStore({ sheetRoot, dbPath });

        expect(result.cards[0]).toEqual(expect.objectContaining({
            tags: ['Sci-Fi', 'Navigator', 'NSFW', 'Dominant'],
        }));
    });

    test('stores card metadata and tags in a sqlite index', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        const dbPath = path.join(tempRoot, 'character-store.sqlite');
        writeCardPng(cardPath, CARD_JSON);
        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'astra.txt'), 'AI-written intro.');

        const result = await scanCharacterStore({ sheetRoot, dbPath });

        const db = new DatabaseSync(dbPath);
        const rows = db.prepare(`
            SELECT c.name, c.category, c.summary, t.name AS tag_name
            FROM store_cards c
            JOIN store_card_tags ct ON ct.card_id = c.id
            JOIN store_tags t ON t.id = ct.tag_id
            ORDER BY t.name
        `).all();
        db.close();

        expect(result.cards).toHaveLength(1);
        expect(rows).toEqual([
            { name: 'Astra', category: 'space/pilots', summary: 'AI-written intro.', tag_name: 'Navigator' },
            { name: 'Astra', category: 'space/pilots', summary: 'AI-written intro.', tag_name: 'Sci-Fi' },
        ]);
    });

    test('removes orphaned store tags after sidecar tag changes', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        const dbPath = path.join(tempRoot, 'character-store.sqlite');
        writeCardPng(cardPath, { ...CARD_JSON, data: { ...CARD_JSON.data, tags: [] } });
        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'astra.tag.txt'), 'Stale\n');
        await scanCharacterStore({ sheetRoot, dbPath });

        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'astra.tag.txt'), 'FreshTag\n');
        await scanCharacterStore({ sheetRoot, dbPath });

        const db = new DatabaseSync(dbPath);
        const rows = db.prepare('SELECT name FROM store_tags ORDER BY name').all();
        db.close();
        expect(rows).toEqual([{ name: 'FreshTag' }]);
    });

    test('returns paginated store cards with database totals', async () => {
        for (let index = 1; index <= 7; index += 1) {
            const name = `Card ${String(index).padStart(2, '0')}`;
            writeCardPng(path.join(sheetRoot, 'space', 'pilots', `${name}.png`), {
                ...CARD_JSON,
                data: { ...CARD_JSON.data, name },
            });
        }

        const result = await scanCharacterStore({
            sheetRoot,
            listOptions: { page: 2, pageSize: 3 },
        });

        expect(result.pagination).toEqual({
            page: 2,
            pageSize: 3,
            total: 7,
            totalPages: 3,
        });
        expect(result.cards.map(card => card.name)).toEqual(['Card 04', 'Card 05', 'Card 06']);
    });

    test('filters paginated store cards by search and tags in the sqlite index', async () => {
        writeCardPng(path.join(sheetRoot, 'space', 'pilots', 'astra.png'), CARD_JSON);
        writeCardPng(path.join(sheetRoot, 'space', 'pilots', 'lyra.png'), {
            ...CARD_JSON,
            data: {
                ...CARD_JSON.data,
                name: 'Lyra',
                description: 'Mapmaker and archivist.',
                tags: ['Fantasy', 'Archivist'],
            },
        });
        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'lyra.txt'), 'Mapmaker profile.');

        const result = await scanCharacterStore({
            sheetRoot,
            listOptions: { page: 1, pageSize: 1, search: 'mapmaker', tags: ['Fantasy'] },
        });

        expect(result.pagination).toEqual({
            page: 1,
            pageSize: 1,
            total: 1,
            totalPages: 1,
        });
        expect(result.cards.map(card => card.name)).toEqual(['Lyra']);
        expect(result.tagStats).toEqual(expect.arrayContaining([{ name: 'Fantasy', count: 1 }]));
    });

    test('skips hidden directories and reports invalid cards without blocking valid cards', async () => {
        writeCardPng(path.join(sheetRoot, 'space', 'pilots', 'astra.png'), CARD_JSON);
        fs.mkdirSync(path.join(sheetRoot, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(sheetRoot, '.claude', 'settings.local.json'), '{}');
        fs.writeFileSync(path.join(sheetRoot, 'space', 'pilots', 'broken.png'), 'not a png card');

        const result = await scanCharacterStore({ sheetRoot });

        expect(result.cards).toHaveLength(1);
        expect(result.cards[0]).toEqual(expect.objectContaining({ name: 'Astra' }));
        expect(result.errors).toEqual([
            expect.objectContaining({
                relativePath: 'space/pilots/broken.png',
            }),
        ]);
    });

    test('imports a selected store card into the user character directory', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        writeCardPng(cardPath, CARD_JSON);
        const scan = await scanCharacterStore({ sheetRoot });

        const result = await importStoreCard({
            sheetRoot,
            charactersDir,
            cardId: scan.cards[0].id,
        });

        expect(result.fileName).toBe('Astra.png');
        expect(fs.existsSync(path.join(charactersDir, 'Astra.png'))).toBe(true);
        expect(fs.existsSync(cardPath)).toBe(true);
    });

    test('imports png store cards regardless of extension case', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.PNG');
        writeCardPng(cardPath, CARD_JSON);
        const scan = await scanCharacterStore({ sheetRoot });

        const result = await importStoreCard({
            sheetRoot,
            charactersDir,
            cardId: scan.cards[0].id,
        });

        expect(result.fileName).toBe('Astra.png');
        expect(fs.existsSync(path.join(charactersDir, 'Astra.png'))).toBe(true);
        const importedJson = JSON.parse(await parse(path.join(charactersDir, 'Astra.png'), 'png'));
        expect(importedJson.data.name).toBe('Astra');
    });

    test('returns absolute preview paths when sheet root is relative', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        writeCardPng(cardPath, CARD_JSON);
        const relativeSheetRoot = path.relative(process.cwd(), sheetRoot);
        const scan = await scanCharacterStore({ sheetRoot: relativeSheetRoot });

        const previewPath = await getStoreCardPreviewPath({
            sheetRoot: relativeSheetRoot,
            cardId: scan.cards[0].id,
        });

        expect(path.isAbsolute(previewPath)).toBe(true);
        expect(previewPath).toBe(cardPath);
    });

    test('resolves preview paths without creating a sqlite index', async () => {
        const cardPath = path.join(sheetRoot, 'space', 'pilots', 'astra.png');
        writeCardPng(cardPath, CARD_JSON);
        const cardId = Buffer.from('space/pilots/astra.png', 'utf8').toString('base64url');

        const previewPath = await getStoreCardPreviewPath({ sheetRoot, cardId });

        expect(previewPath).toBe(cardPath);
        expect(fs.existsSync(path.join(tempRoot, 'character-store.sqlite'))).toBe(false);
    });
});
