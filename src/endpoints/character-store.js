import express from 'express';

import {
    getCharacterStoreRoot,
    getStoreCardPreviewPath,
    importStoreCard,
    listCharacterStore,
    scanCharacterStore,
} from '../character-card-store.js';

export const router = express.Router();

router.post('/list', async (_request, response) => {
    try {
        const listOptions = getStoreListOptions(_request.body);
        const store = await getCharacterStoreList({
            listOptions,
            refresh: _request.body?.refresh !== false,
        });
        return response.send(store);
    } catch (error) {
        console.error('Failed to list character store cards:', error);
        const status = error instanceof TypeError ? 400 : 500;
        return response.status(status).send({ error: true, message: String(error.message || error) });
    }
});

router.post('/import', async (request, response) => {
    try {
        const cardId = request.body?.card_id;
        if (typeof cardId !== 'string' || !cardId) {
            return response.status(400).send({ error: true, message: 'Missing card_id.' });
        }

        const result = await importStoreCard({
            sheetRoot: getCharacterStoreRoot(),
            charactersDir: request.user.directories.characters,
            cardId,
        });

        return response.send({ file_name: result.fileName });
    } catch (error) {
        console.error('Failed to import character store card:', error);
        return response.status(500).send({ error: true, message: String(error.message || error) });
    }
});

router.get('/preview/:cardId', async (request, response) => {
    try {
        const previewPath = await getStoreCardPreviewPath({
            sheetRoot: getCharacterStoreRoot(),
            cardId: request.params.cardId,
        });
        return response.sendFile(previewPath);
    } catch (error) {
        console.error('Failed to load character store preview:', error);
        return response.status(404).send({ error: true, message: String(error.message || error) });
    }
});

async function getCharacterStoreList({ listOptions, refresh }) {
    const loader = refresh ? scanCharacterStore : listCharacterStore;
    return await loader({
        sheetRoot: getCharacterStoreRoot(),
        listOptions,
    });
}

function getStoreListOptions(body = {}) {
    if (body === null || Array.isArray(body) || typeof body !== 'object') {
        throw new TypeError('Invalid character store list request.');
    }
    return {
        page: getPositiveIntegerOption(body.page, 'page'),
        pageSize: getPositiveIntegerOption(body.page_size ?? body.pageSize, 'page_size'),
        search: getStringOption(body.search, 'search'),
        tags: getTagsOption(body.tags),
    };
}

function getPositiveIntegerOption(value, name) {
    if (value === undefined) {
        return undefined;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new TypeError(`Invalid character store ${name}.`);
    }
    return number;
}

function getStringOption(value, name) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new TypeError(`Invalid character store ${name}.`);
    }
    return value;
}

function getTagsOption(value) {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string')) {
        throw new TypeError('Invalid character store tags.');
    }
    return value;
}
