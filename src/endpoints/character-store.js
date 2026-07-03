import crypto from 'node:crypto';
import { promises as fsPromises } from 'node:fs';

import express from 'express';

import {
    getCharacterStoreRoot,
    getStoreCardPreviewPath,
    importStoreCard,
    listCharacterStore,
    scanCharacterStore,
} from '../character-card-store.js';
import {
    approveStoreSubmission,
    createStoreSubmission,
    getStoreSubmissionPreviewPath,
    importStoreSubmissionToLibrary,
    listPendingStoreSubmissions,
    rejectStoreSubmission,
} from '../character-store-submissions.js';
import { getConfigValue } from '../util.js';

export const router = express.Router();

const REVIEW_KEY_CONFIG_KEY = 'characterStore.adminReviewKey';
const REVIEW_UNLOCK_SESSION_KEY = 'characterStoreAdminUnlocked';
const ORIGINAL_CONFIRMATION_REQUIRED_MESSAGE = 'Original character card confirmation is required.';

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

router.post('/submissions/upload', async (request, response) => {
    try {
        if (!request.file) {
            return response.status(400).send({ error: true, message: 'Missing character card upload.' });
        }
        if (!isOriginalConfirmationAccepted(request.body?.original_confirmed)) {
            await removeUploadedFile(request.file);
            return response.status(400).send({ error: true, message: ORIGINAL_CONFIRMATION_REQUIRED_MESSAGE });
        }

        const submission = await createStoreSubmission({
            dataRoot: globalThis.DATA_ROOT,
            uploadPath: getUploadedFilePath(request.file),
            originalFileName: request.file.originalname,
            user: request.user.profile,
            fields: request.body,
        });

        return response.send(submission);
    } catch (error) {
        console.error('Failed to upload character store submission:', error);
        return sendStoreError(response, error);
    }
});

router.post('/submissions/unlock-status', requireStoreAdminMiddleware, (request, response) => {
    return response.send(getStoreReviewUnlockStatus(request));
});

router.post('/submissions/unlock', requireStoreAdminMiddleware, (request, response) => {
    const reviewKey = getStoreReviewKey();

    if (!reviewKey) {
        setStoreReviewUnlocked(request);
        return response.send({ required: false, unlocked: true });
    }

    const submittedKey = request.body?.key;
    if (typeof submittedKey !== 'string' || !timingSafeStringEqual(submittedKey, reviewKey)) {
        console.warn('Invalid character store review key attempt:', request.originalUrl);
        return response.status(403).send({ error: true, message: 'Invalid character store review key.' });
    }

    setStoreReviewUnlocked(request);
    return response.send({ required: true, unlocked: true });
});

router.post('/submissions/list', requireStoreAdminMiddleware, requireStoreReviewUnlockMiddleware, async (_request, response) => {
    try {
        const submissions = await listPendingStoreSubmissions({ dataRoot: globalThis.DATA_ROOT });
        return response.send({ submissions });
    } catch (error) {
        console.error('Failed to list character store submissions:', error);
        return sendStoreError(response, error);
    }
});

router.post('/submissions/approve', requireStoreAdminMiddleware, requireStoreReviewUnlockMiddleware, async (request, response) => {
    try {
        const submissionId = getSubmissionId(request.body);
        const approved = await approveStoreSubmission({
            dataRoot: globalThis.DATA_ROOT,
            submissionId,
            reviewer: request.user.profile,
            fields: request.body,
        });
        await scanCharacterStore({ sheetRoot: getCharacterStoreRoot() });
        return response.send(approved);
    } catch (error) {
        console.error('Failed to approve character store submission:', error);
        return sendStoreError(response, error);
    }
});

router.post('/submissions/reject', requireStoreAdminMiddleware, requireStoreReviewUnlockMiddleware, async (request, response) => {
    try {
        const submissionId = getSubmissionId(request.body);
        const rejected = await rejectStoreSubmission({
            dataRoot: globalThis.DATA_ROOT,
            submissionId,
            reviewer: request.user.profile,
            reason: request.body?.reason,
        });
        return response.send(rejected);
    } catch (error) {
        console.error('Failed to reject character store submission:', error);
        return sendStoreError(response, error);
    }
});

router.post('/submissions/import', requireStoreAdminMiddleware, requireStoreReviewUnlockMiddleware, async (request, response) => {
    try {
        const submissionId = getSubmissionId(request.body);
        const imported = await importStoreSubmissionToLibrary({
            dataRoot: globalThis.DATA_ROOT,
            submissionId,
            charactersDir: request.user.directories.characters,
            fields: request.body,
        });
        return response.send({ file_name: imported.fileName });
    } catch (error) {
        console.error('Failed to import character store submission:', error);
        return sendStoreError(response, error);
    }
});

router.get('/submissions/preview/:submissionId', requireStoreAdminMiddleware, requireStoreReviewUnlockMiddleware, async (request, response) => {
    try {
        const previewPath = await getStoreSubmissionPreviewPath({
            dataRoot: globalThis.DATA_ROOT,
            submissionId: request.params.submissionId,
        });
        return response.sendFile(previewPath);
    } catch (error) {
        console.error('Failed to load character store submission preview:', error);
        return sendStoreError(response, error);
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

function getUploadedFilePath(file) {
    return file.path || `${file.destination}/${file.filename}`;
}

function isOriginalConfirmationAccepted(value) {
    return value === true || value === 'true';
}

async function removeUploadedFile(file) {
    try {
        await fsPromises.unlink(getUploadedFilePath(file));
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn('Failed to remove rejected character store upload:', error);
        }
    }
}

function getSubmissionId(body = {}) {
    const submissionId = body?.id ?? body?.submission_id ?? body?.submissionId;
    if (typeof submissionId !== 'string' || !submissionId) {
        throw Object.assign(new Error('Missing character store submission id.'), { status: 400 });
    }
    return submissionId;
}

function sendStoreError(response, error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return response.status(status).send({ error: true, message: String(error?.message || error) });
}

function requireStoreAdminMiddleware(request, response, next) {
    if (request.user?.profile?.admin) {
        return next();
    }

    console.warn('Unauthorized access to character store admin endpoint:', request.originalUrl);
    return response.sendStatus(403);
}

function requireStoreReviewUnlockMiddleware(request, response, next) {
    if (getStoreReviewUnlockStatus(request).unlocked) {
        return next();
    }

    console.warn('Locked access to character store review endpoint:', request.originalUrl);
    return response.status(403).send({ error: true, message: 'Character store review key required.' });
}

function getStoreReviewUnlockStatus(request) {
    const required = Boolean(getStoreReviewKey());
    return {
        required,
        unlocked: !required || request.session?.[REVIEW_UNLOCK_SESSION_KEY] === true,
    };
}

function getStoreReviewKey() {
    const value = getConfigValue(REVIEW_KEY_CONFIG_KEY, '');
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function setStoreReviewUnlocked(request) {
    if (request.session) {
        request.session[REVIEW_UNLOCK_SESSION_KEY] = true;
    }
}

function timingSafeStringEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

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
