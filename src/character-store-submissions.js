import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import sanitize from 'sanitize-filename';

import { DEFAULT_AVATAR_PATH } from './constants.js';
import { parse, write } from './character-card-parser.js';
import { serverDirectory } from './server-directory.js';

const SUBMISSIONS_DIRECTORY = 'character-store-submissions';
const SHEET_DIRECTORY = 'sheet';
const METADATA_FILE = 'metadata.json';
const CARD_BASENAME = 'card';
const DEFAULT_CATEGORY = '综合';
const LEGACY_DEFAULT_CATEGORY = 'user-submissions';
const PENDING_STATUS = 'pending';
const APPROVED_STATUS = 'approved';
const REJECTED_STATUS = 'rejected';
const JSON_EXTENSION = '.json';
const PNG_EXTENSION = '.png';
const SUPPORTED_EXTENSIONS = new Set([PNG_EXTENSION, JSON_EXTENSION]);
const FIRST_SUFFIX = 0;

export async function createStoreSubmission({
    dataRoot = globalThis.DATA_ROOT,
    uploadPath,
    originalFileName,
    user,
    fields = {},
}) {
    let submissionDir = '';
    try {
        const format = getSupportedFormat(originalFileName || uploadPath);
        const rawCard = await readUploadedCard(uploadPath, format);
        const card = parseCardJson(rawCard);
        const id = crypto.randomUUID();
        const fileName = `${CARD_BASENAME}.${format}`;
        const now = new Date().toISOString();
        const metadata = {
            id,
            status: PENDING_STATUS,
            submittedAt: now,
            submittedBy: normalizeUser(user),
            originalFileName: String(originalFileName || path.basename(uploadPath)),
            fileName,
            format,
            cardName: getCardName(card, originalFileName || uploadPath),
            displayName: normalizeDisplayName(fields.name, getCardName(card, originalFileName || uploadPath)),
            category: normalizeCategory(fields.category),
            tags: normalizeTags(fields.tags),
            summary: normalizeSummary(fields.summary),
            originalConfirmed: isOriginalConfirmationAccepted(fields.original_confirmed),
            reviewedAt: null,
            reviewedBy: null,
            rejectionReason: '',
            publishedRelativePath: '',
        };

        submissionDir = getSubmissionDirectory(dataRoot, PENDING_STATUS, id);
        await fsPromises.mkdir(submissionDir, { recursive: true });
        await fsPromises.copyFile(uploadPath, path.join(submissionDir, fileName));
        await fsPromises.unlink(uploadPath);
        await writeMetadata(submissionDir, metadata);
        return metadata;
    } catch (error) {
        await removeIfExists(submissionDir);
        await unlinkIfExists(uploadPath);
        throw error;
    }
}

export async function listPendingStoreSubmissions({ dataRoot = globalThis.DATA_ROOT } = {}) {
    const pendingRoot = getStatusRoot(dataRoot, PENDING_STATUS);
    let entries = [];
    try {
        entries = await fsPromises.readdir(pendingRoot, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const submissions = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        try {
            const metadata = await readMetadata(path.join(pendingRoot, entry.name));
            if (metadata.status === PENDING_STATUS) {
                submissions.push(metadata);
            }
        } catch (error) {
            console.warn(`Skipping invalid character store submission metadata: ${entry.name}`, error);
        }
    }

    return submissions.sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)));
}

export async function approveStoreSubmission({
    dataRoot = globalThis.DATA_ROOT,
    submissionId,
    reviewer,
    fields = {},
}) {
    const pendingDir = getSubmissionDirectory(dataRoot, PENDING_STATUS, submissionId);
    const metadata = await readPendingMetadata(pendingDir);
    const sourcePath = path.join(pendingDir, metadata.fileName);
    const rawCard = await readUploadedCard(sourcePath, metadata.format);
    const card = parseCardJson(rawCard);
    const displayName = normalizeDisplayName(fields.name ?? metadata.displayName, metadata.displayName || metadata.cardName);
    const category = normalizeCategory(fields.category ?? metadata.category);
    const tags = fields.tags === undefined ? normalizeTags(metadata.tags) : normalizeTags(fields.tags);
    const summary = normalizeSummary(fields.summary ?? metadata.summary);
    const sheetRoot = path.resolve(dataRoot, SHEET_DIRECTORY);
    const publicPath = await getUniquePublicCardPath({ sheetRoot, category, displayName, format: metadata.format });
    const relativePath = toStorePath(path.relative(sheetRoot, publicPath));
    const reviewedMetadata = {
        ...metadata,
        status: APPROVED_STATUS,
        displayName,
        category,
        tags,
        summary,
        reviewedAt: new Date().toISOString(),
        reviewedBy: normalizeUser(reviewer),
        rejectionReason: '',
        publishedRelativePath: relativePath,
    };

    setCardName(card, displayName);
    await fsPromises.mkdir(path.dirname(publicPath), { recursive: true });
    await writePublicCard({ sourcePath, publicPath, card, format: metadata.format });
    await writeSidecars({ publicPath, summary, tags });
    await writeMetadata(pendingDir, reviewedMetadata);
    await moveSubmissionDirectory({ dataRoot, submissionId, fromStatus: PENDING_STATUS, toStatus: APPROVED_STATUS });
    return reviewedMetadata;
}

export async function rejectStoreSubmission({
    dataRoot = globalThis.DATA_ROOT,
    submissionId,
    reviewer,
    reason = '',
}) {
    const pendingDir = getSubmissionDirectory(dataRoot, PENDING_STATUS, submissionId);
    const metadata = await readPendingMetadata(pendingDir);
    const rejectedMetadata = {
        ...metadata,
        status: REJECTED_STATUS,
        reviewedAt: new Date().toISOString(),
        reviewedBy: normalizeUser(reviewer),
        rejectionReason: normalizeSummary(reason),
    };

    await writeMetadata(pendingDir, rejectedMetadata);
    await moveSubmissionDirectory({ dataRoot, submissionId, fromStatus: PENDING_STATUS, toStatus: REJECTED_STATUS });
    return rejectedMetadata;
}

export async function importStoreSubmissionToLibrary({
    dataRoot = globalThis.DATA_ROOT,
    submissionId,
    charactersDir,
    fields = {},
}) {
    const pendingDir = getSubmissionDirectory(dataRoot, PENDING_STATUS, submissionId);
    const metadata = await readPendingMetadata(pendingDir);
    const sourcePath = path.join(pendingDir, metadata.fileName);
    const rawCard = await readUploadedCard(sourcePath, metadata.format);
    const card = parseCardJson(rawCard);
    const displayName = normalizeDisplayName(fields.name ?? metadata.displayName, metadata.displayName || metadata.cardName);
    const outputPath = await getUniqueCharacterCardPath({ charactersDir, displayName });

    setCardName(card, displayName);
    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
    await writeCharacterLibraryCard({ sourcePath, outputPath, card, format: metadata.format });
    return {
        fileName: path.basename(outputPath),
        submission: metadata,
    };
}

export async function getStoreSubmissionPreviewPath({ dataRoot = globalThis.DATA_ROOT, submissionId }) {
    const pendingDir = getSubmissionDirectory(dataRoot, PENDING_STATUS, submissionId);
    const metadata = await readPendingMetadata(pendingDir);
    if (metadata.format === 'png') {
        return path.join(pendingDir, metadata.fileName);
    }

    return path.join(serverDirectory, DEFAULT_AVATAR_PATH);
}

function getSupportedFormat(fileName) {
    const extension = path.extname(String(fileName || '')).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw withStatus(new Error('Unsupported character card format.'), 400);
    }
    return extension.slice(1);
}

async function readUploadedCard(filePath, format) {
    try {
        if (format === 'png') {
            return await parse(filePath, 'png');
        }
        if (format === 'json') {
            return await fsPromises.readFile(filePath, 'utf8');
        }
    } catch (error) {
        throw withStatus(new Error(`Invalid character card: ${error.message || error}`), 400);
    }
    throw withStatus(new Error('Unsupported character card format.'), 400);
}

function parseCardJson(rawCard) {
    try {
        return JSON.parse(rawCard);
    } catch (error) {
        throw withStatus(new Error(`Invalid character card: ${error.message || error}`), 400);
    }
}

function getCardName(card, fileName) {
    const fallback = sanitize(path.parse(String(fileName || '')).name) || 'character';
    return String(card?.data?.name || card?.name || fallback).trim() || fallback;
}

function setCardName(card, displayName) {
    if (card && typeof card === 'object') {
        card.name = displayName;
        if (card.data && typeof card.data === 'object') {
            card.data.name = displayName;
        }
    }
}

async function writePublicCard({ sourcePath, publicPath, card, format }) {
    const rawCard = JSON.stringify(card);
    if (format === 'png') {
        const sourceImage = await fsPromises.readFile(sourcePath);
        await fsPromises.writeFile(publicPath, write(sourceImage, rawCard));
        return;
    }
    await fsPromises.writeFile(publicPath, `${JSON.stringify(card, null, 4)}\n`);
}

async function writeCharacterLibraryCard({ sourcePath, outputPath, card, format }) {
    const rawCard = JSON.stringify(card);
    const sourceImage = format === 'png'
        ? await fsPromises.readFile(sourcePath)
        : await fsPromises.readFile(path.join(serverDirectory, DEFAULT_AVATAR_PATH));
    await fsPromises.writeFile(outputPath, write(sourceImage, rawCard));
}

async function writeSidecars({ publicPath, summary, tags }) {
    const sidecarBase = publicPath.slice(0, -path.extname(publicPath).length);
    if (summary) {
        await fsPromises.writeFile(`${sidecarBase}.txt`, summary);
    }
    if (tags.length) {
        await fsPromises.writeFile(`${sidecarBase}.tag.txt`, tags.join('\n'));
    }
}

async function getUniqueCharacterCardPath({ charactersDir, displayName }) {
    const baseName = sanitize(displayName) || 'character';
    let suffix = FIRST_SUFFIX;
    while (true) {
        const candidate = suffix === FIRST_SUFFIX ? baseName : `${baseName}${suffix}`;
        const outputPath = path.join(charactersDir, `${candidate}${PNG_EXTENSION}`);
        if (!fs.existsSync(outputPath)) {
            return outputPath;
        }
        suffix += 1;
    }
}

async function getUniquePublicCardPath({ sheetRoot, category, displayName, format }) {
    const categoryDirectory = path.join(sheetRoot, ...category.split('/'));
    const baseName = sanitize(displayName) || 'character';
    const extension = `.${format}`;
    let suffix = FIRST_SUFFIX;
    while (true) {
        const candidate = suffix === FIRST_SUFFIX ? baseName : `${baseName}${suffix}`;
        const outputPath = path.join(categoryDirectory, `${candidate}${extension}`);
        if (!fs.existsSync(outputPath)) {
            return outputPath;
        }
        suffix += 1;
    }
}

async function moveSubmissionDirectory({ dataRoot, submissionId, fromStatus, toStatus }) {
    const source = getSubmissionDirectory(dataRoot, fromStatus, submissionId);
    const destination = getSubmissionDirectory(dataRoot, toStatus, submissionId);
    await fsPromises.mkdir(path.dirname(destination), { recursive: true });
    await fsPromises.rename(source, destination);
}

async function readPendingMetadata(pendingDir) {
    const metadata = await readMetadata(pendingDir);
    if (metadata.status !== PENDING_STATUS) {
        throw withStatus(new Error('Character store submission is no longer pending.'), 409);
    }
    return metadata;
}

async function readMetadata(submissionDir) {
    try {
        const text = await fsPromises.readFile(path.join(submissionDir, METADATA_FILE), 'utf8');
        return JSON.parse(text);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw withStatus(new Error('Character store submission not found.'), 404);
        }
        throw error;
    }
}

async function writeMetadata(submissionDir, metadata) {
    await fsPromises.writeFile(path.join(submissionDir, METADATA_FILE), `${JSON.stringify(metadata, null, 4)}\n`);
}

function getSubmissionDirectory(dataRoot, status, submissionId) {
    const id = String(submissionId || '');
    if (!id || id.includes('/') || id.includes('\\') || path.isAbsolute(id)) {
        throw withStatus(new Error('Invalid character store submission id.'), 400);
    }
    return path.join(getStatusRoot(dataRoot, status), id);
}

function getStatusRoot(dataRoot, status) {
    return path.join(getSubmissionsRoot(dataRoot), status);
}

function getSubmissionsRoot(dataRoot) {
    return path.resolve(dataRoot, SUBMISSIONS_DIRECTORY);
}

function normalizeUser(user = {}) {
    const handle = String(user.handle || '').trim();
    return {
        handle,
        name: String(user.name || handle || 'Unknown').trim() || handle || 'Unknown',
    };
}

function normalizeDisplayName(value, fallback) {
    const displayName = String(value || fallback || '').trim();
    if (!displayName) {
        throw withStatus(new Error('Missing character card name.'), 400);
    }
    return displayName;
}

function normalizeCategory(value) {
    const segments = String(value || '')
        .split(/[\\/]+/)
        .map(segment => sanitize(segment.trim()))
        .map(segment => segment.replace(/^\.+$/, ''))
        .filter(Boolean);
    if (segments.length === 1 && segments[0] === LEGACY_DEFAULT_CATEGORY) {
        return DEFAULT_CATEGORY;
    }
    return segments.length ? segments.join('/') : DEFAULT_CATEGORY;
}

function normalizeTags(value) {
    const tags = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,，、;；]+/);
    const seen = new Set();
    const result = [];
    for (const tag of tags.map(tag => String(tag).trim()).filter(Boolean)) {
        if (!seen.has(tag)) {
            seen.add(tag);
            result.push(tag);
        }
    }
    return result;
}

function normalizeSummary(value) {
    return String(value || '').trim();
}

function isOriginalConfirmationAccepted(value) {
    return value === true || value === 'true';
}

function toStorePath(value) {
    return value.split(path.sep).join('/');
}

async function removeIfExists(filePath) {
    if (!filePath) {
        return;
    }
    await fsPromises.rm(filePath, { recursive: true, force: true });
}

async function unlinkIfExists(filePath) {
    if (!filePath) {
        return;
    }
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
}

function withStatus(error, status) {
    error.status = status;
    return error;
}
