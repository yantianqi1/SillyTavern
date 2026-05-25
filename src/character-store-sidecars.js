import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

const SUMMARY_EXTENSION = '.txt';
const TAG_SUFFIX = '.tag.txt';

const EMPTY_CONTENT = Object.freeze({ text: '', mtimeMs: 0, size: 0 });
const EMPTY_SNAPSHOT = Object.freeze({ mtimeMs: 0, size: 0 });

export async function readCardSidecars(sheetRoot, relativePath) {
    const [summary, tag] = await Promise.all([
        readSidecarContent(getSummaryPath(sheetRoot, relativePath)),
        readSidecarContent(getTagPath(sheetRoot, relativePath)),
    ]);
    return { summary, tag };
}

export async function getCardSidecarSnapshot(sheetRoot, relativePath) {
    const [summary, tag] = await Promise.all([
        readSidecarSnapshot(getSummaryPath(sheetRoot, relativePath)),
        readSidecarSnapshot(getTagPath(sheetRoot, relativePath)),
    ]);
    return { summary, tag };
}

export function parseTagSidecarText(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(tag => String(tag).trim())
        .filter(Boolean);
}

function getSummaryPath(sheetRoot, relativePath) {
    return `${getSidecarBasePath(sheetRoot, relativePath)}${SUMMARY_EXTENSION}`;
}

function getTagPath(sheetRoot, relativePath) {
    return `${getSidecarBasePath(sheetRoot, relativePath)}${TAG_SUFFIX}`;
}

function getSidecarBasePath(sheetRoot, relativePath) {
    const parsedPath = path.parse(relativePath);
    return path.join(sheetRoot, parsedPath.dir, parsedPath.name);
}

async function readSidecarContent(filePath) {
    try {
        const stat = await fsPromises.stat(filePath);
        const text = (await fsPromises.readFile(filePath, 'utf8')).trim();
        return { text, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return EMPTY_CONTENT;
        }
        throw error;
    }
}

async function readSidecarSnapshot(filePath) {
    try {
        const stat = await fsPromises.stat(filePath);
        return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return EMPTY_SNAPSHOT;
        }
        throw error;
    }
}
