import express from 'express';

import {
    getCharacterStoreRoot,
    getStoreCardPreviewPath,
    importStoreCard,
    scanCharacterStore,
} from '../character-card-store.js';

export const router = express.Router();

router.post('/list', async (_request, response) => {
    try {
        const store = await scanCharacterStore({ sheetRoot: getCharacterStoreRoot() });
        return response.send(store);
    } catch (error) {
        console.error('Failed to list character store cards:', error);
        return response.status(500).send({ error: true, message: String(error.message || error) });
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
