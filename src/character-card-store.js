import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import sanitize from 'sanitize-filename';

import { DEFAULT_AVATAR_PATH } from './constants.js';
import { parse, write } from './character-card-parser.js';
import { getCardSidecarSnapshot, parseTagSidecarText, readCardSidecars } from './character-store-sidecars.js';
import { getCharacterStoreDatabasePath, openCharacterStoreIndex } from './character-store-sqlite-index.js';
import { serverDirectory } from './server-directory.js';

const CARD_EXTENSIONS = new Set(['.png', '.json']);
const JSON_EXTENSION = '.json';
const PNG_EXTENSION = '.png';
const SHEET_DIRECTORY = 'sheet';
const FIRST_SUFFIX = 0;

export function getCharacterStoreRoot(dataRoot = globalThis.DATA_ROOT) {
    return path.resolve(dataRoot, SHEET_DIRECTORY);
}

export async function scanCharacterStore({ sheetRoot, dbPath = null, listOptions = {} }) {
    const resolvedSheetRoot = path.resolve(sheetRoot);
    const index = await openCharacterStoreIndex(resolveDatabasePath(resolvedSheetRoot, dbPath));
    try {
        await syncCharacterStoreIndex({ sheetRoot: resolvedSheetRoot, index });
        return index.listStore(listOptions);
    } finally {
        index.close();
    }
}

export async function listCharacterStore({ sheetRoot, dbPath = null, listOptions = {} }) {
    const resolvedSheetRoot = path.resolve(sheetRoot);
    const index = await openCharacterStoreIndex(resolveDatabasePath(resolvedSheetRoot, dbPath));
    try {
        return index.listStore(listOptions);
    } finally {
        index.close();
    }
}

export async function importStoreCard({ sheetRoot, charactersDir, cardId, dbPath = null }) {
    const resolvedSheetRoot = path.resolve(sheetRoot);
    const card = await getStoreCard({ sheetRoot: resolvedSheetRoot, cardId, dbPath });
    if (!card) {
        throw new Error(`Character store card not found: ${cardId}`);
    }

    await fsPromises.mkdir(charactersDir, { recursive: true });
    const sourcePath = path.join(resolvedSheetRoot, card.relativePath);
    const outputBase = await getUniqueCardBase(card.name, charactersDir);
    const outputPath = path.join(charactersDir, `${outputBase}${PNG_EXTENSION}`);

    if (card.format === 'png') {
        await fsPromises.copyFile(sourcePath, outputPath);
    } else {
        await writeJsonCard(sourcePath, outputPath);
    }

    return { fileName: path.basename(outputPath), card };
}

export async function getStoreCardPreviewPath({ sheetRoot, cardId }) {
    const resolvedSheetRoot = path.resolve(sheetRoot);
    const relativePath = decodeCardId(cardId);
    assertSafeStorePath(relativePath);
    if (path.extname(relativePath).toLowerCase() === PNG_EXTENSION) {
        return resolveStoreFilePath(resolvedSheetRoot, relativePath);
    }

    return path.join(serverDirectory, DEFAULT_AVATAR_PATH);
}

async function getStoreCard({ sheetRoot, cardId, dbPath }) {
    const index = await openCharacterStoreIndex(resolveDatabasePath(sheetRoot, dbPath));
    try {
        await syncCharacterStoreIndex({ sheetRoot, index });
        return index.getCardById(cardId);
    } finally {
        index.close();
    }
}

function resolveDatabasePath(sheetRoot, dbPath) {
    return dbPath ?? getCharacterStoreDatabasePath(path.dirname(sheetRoot));
}

async function syncCharacterStoreIndex({ sheetRoot, index }) {
    if (!fs.existsSync(sheetRoot)) {
        index.applySync({ cards: [], currentRelativePaths: [] });
        return;
    }
    const relativePaths = await collectCardPaths(sheetRoot, '');
    const cards = [];
    const errors = [];
    for (const relativePath of relativePaths) {
        await syncCardPath({ sheetRoot, index, relativePath, cards, errors });
    }
    index.applySync({ cards, currentRelativePaths: relativePaths, errors });
}

async function syncCardPath({ sheetRoot, index, relativePath, cards, errors }) {
    try {
        const card = await buildStoreCardIfChanged({ sheetRoot, index, relativePath });
        if (card) {
            cards.push(card);
        }
    } catch (error) {
        errors.push({ relativePath, message: String(error.message || error) });
    }
}

async function collectCardPaths(root, current) {
    const currentPath = path.join(root, current);
    const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
    const nestedPaths = [];

    for (const entry of entries) {
        if (isHiddenEntry(entry.name)) {
            continue;
        }
        const relativePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
            nestedPaths.push(...await collectCardPaths(root, relativePath));
        } else if (isSupportedCard(entry.name)) {
            nestedPaths.push(toStorePath(relativePath));
        }
    }

    return nestedPaths.sort((left, right) => left.localeCompare(right));
}

async function buildStoreCard(sheetRoot, relativePath) {
    const absolutePath = path.join(sheetRoot, relativePath);
    const sourceStat = await fsPromises.stat(absolutePath);
    const sidecars = await readCardSidecars(sheetRoot, relativePath);
    const rawCard = await readCardJson(absolutePath);
    const card = JSON.parse(rawCard);
    const name = getCardName(card, relativePath);
    const tags = getCardTags(card, sidecars.tag.text);

    return {
        id: encodeCardId(relativePath),
        category: getCategory(relativePath),
        format: path.extname(relativePath).slice(1).toLowerCase(),
        name,
        relativePath,
        summary: sidecars.summary.text,
        sourceMtimeMs: sourceStat.mtimeMs,
        sourceSize: sourceStat.size,
        summaryMtimeMs: sidecars.summary.mtimeMs,
        tagMtimeMs: sidecars.tag.mtimeMs,
        tagSize: sidecars.tag.size,
        tags,
    };
}

async function buildStoreCardIfChanged({ sheetRoot, index, relativePath }) {
    const sourceStat = await fsPromises.stat(path.join(sheetRoot, relativePath));
    const sidecars = await getCardSidecarSnapshot(sheetRoot, relativePath);
    const snapshot = index.getFileSnapshot(relativePath);
    if (isUnchangedCard(snapshot, sourceStat, sidecars)) {
        return null;
    }
    return await buildStoreCard(sheetRoot, relativePath);
}

async function readCardJson(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === PNG_EXTENSION) {
        return await parse(filePath, 'png');
    }

    if (extension === JSON_EXTENSION) {
        return await fsPromises.readFile(filePath, 'utf8');
    }

    throw new Error(`Unsupported character store file: ${filePath}`);
}

function getCardName(card, relativePath) {
    const fallback = path.parse(relativePath).name;
    return String(card?.data?.name || card?.name || fallback).trim() || fallback;
}

function getCardTags(card, tagSidecarText = '') {
    const tags = card?.data?.tags ?? card?.tags ?? [];
    if (Array.isArray(tags)) {
        return uniqueTags([...tags.map(normalizeTag), ...parseTagSidecarText(tagSidecarText)]);
    }
    if (typeof tags === 'string') {
        return uniqueTags([...tags.split(',').map(normalizeTag), ...parseTagSidecarText(tagSidecarText)]);
    }
    return uniqueTags(parseTagSidecarText(tagSidecarText));
}

async function getUniqueCardBase(name, charactersDir) {
    const baseName = sanitize(name) || 'character';
    let suffix = FIRST_SUFFIX;
    while (true) {
        const candidate = suffix === FIRST_SUFFIX ? baseName : `${baseName}${suffix}`;
        const outputPath = path.join(charactersDir, `${candidate}${PNG_EXTENSION}`);
        if (!fs.existsSync(outputPath)) {
            return candidate;
        }
        suffix += 1;
    }
}

async function writeJsonCard(sourcePath, outputPath) {
    const defaultAvatar = await fsPromises.readFile(path.join(serverDirectory, DEFAULT_AVATAR_PATH));
    const rawCard = await fsPromises.readFile(sourcePath, 'utf8');
    const outputImage = write(defaultAvatar, rawCard);
    await fsPromises.writeFile(outputPath, outputImage);
}

function getCategory(relativePath) {
    return toStorePath(path.dirname(relativePath)).replace(/^\.$/, '');
}

function encodeCardId(relativePath) {
    return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function isSupportedCard(fileName) {
    return CARD_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isHiddenEntry(name) {
    return name.startsWith('.');
}

function normalizeTag(tag) {
    return String(tag).trim();
}

function uniqueTags(tags) {
    const seen = new Set();
    const result = [];
    for (const tag of tags.map(normalizeTag).filter(Boolean)) {
        if (!seen.has(tag)) {
            seen.add(tag);
            result.push(tag);
        }
    }
    return result;
}

function isUnchangedCard(snapshot, sourceStat, sidecars) {
    if (!snapshot) {
        return false;
    }
    return snapshot.source_mtime_ms === sourceStat.mtimeMs
        && snapshot.source_size === sourceStat.size
        && snapshot.summary_mtime_ms === sidecars.summary.mtimeMs
        && snapshot.tag_mtime_ms === sidecars.tag.mtimeMs
        && snapshot.tag_size === sidecars.tag.size;
}

function toStorePath(value) {
    return value.split(path.sep).join('/');
}

function decodeCardId(cardId) {
    if (typeof cardId !== 'string' || !cardId) {
        throw new Error('Missing character store card id.');
    }
    return Buffer.from(cardId, 'base64url').toString('utf8');
}

function assertSafeStorePath(relativePath) {
    if (!relativePath || relativePath.includes('\\') || path.isAbsolute(relativePath)) {
        throw new Error(`Invalid character store preview path: ${relativePath}`);
    }
    if (path.posix.normalize(relativePath) !== relativePath || !isSupportedCard(relativePath)) {
        throw new Error(`Invalid character store preview path: ${relativePath}`);
    }
}

function resolveStoreFilePath(sheetRoot, relativePath) {
    const absolutePath = path.resolve(sheetRoot, relativePath);
    const rootPrefix = sheetRoot.endsWith(path.sep) ? sheetRoot : `${sheetRoot}${path.sep}`;
    if (!absolutePath.startsWith(rootPrefix)) {
        throw new Error(`Character store preview path escapes sheet root: ${relativePath}`);
    }
    return absolutePath;
}
