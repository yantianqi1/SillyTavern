import crypto from 'node:crypto';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import archiver from 'archiver';
import yauzl from 'yauzl';

import { color, getConfigValue } from './util.js';

const MANIFEST_VERSION = 1;
const DEFAULT_PREFIX = 'sillytavern';
const EMPTY_ROOT_IGNORED_ENTRIES = new Set(['access.log', 'heartbeat.json']);

/**
 * @typedef {Object} CloudBackupConfig
 * @property {boolean} enabled
 * @property {string} endpoint
 * @property {string} region
 * @property {string} bucket
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 * @property {boolean} forcePathStyle
 * @property {string} prefix
 * @property {boolean} scheduleEnabled
 * @property {number} intervalHours
 * @property {number} startupDelaySeconds
 * @property {number} keepBackups
 * @property {boolean} restoreEnabled
 * @property {'emptyDataRootOnly'|'always'} restoreMode
 */

/**
 * Reads cloud backup settings from config.yaml.
 * @returns {CloudBackupConfig}
 */
export function getCloudBackupConfig() {
    return {
        enabled: getConfigValue('cloudBackups.enabled', false, 'boolean'),
        endpoint: String(getConfigValue('cloudBackups.endpoint', '') || '').trim(),
        region: String(getConfigValue('cloudBackups.region', 'auto') || 'auto').trim(),
        bucket: String(getConfigValue('cloudBackups.bucket', '') || '').trim(),
        accessKeyId: String(getConfigValue('cloudBackups.accessKeyId', '') || '').trim(),
        secretAccessKey: String(getConfigValue('cloudBackups.secretAccessKey', '') || ''),
        forcePathStyle: getConfigValue('cloudBackups.forcePathStyle', true, 'boolean'),
        prefix: String(getConfigValue('cloudBackups.prefix', DEFAULT_PREFIX) || DEFAULT_PREFIX).trim(),
        scheduleEnabled: getConfigValue('cloudBackups.schedule.enabled', true, 'boolean'),
        intervalHours: getConfigValue('cloudBackups.schedule.intervalHours', 24, 'number'),
        startupDelaySeconds: getConfigValue('cloudBackups.schedule.startupDelaySeconds', 60, 'number'),
        keepBackups: getConfigValue('cloudBackups.retention.keepBackups', 7, 'number'),
        restoreEnabled: getConfigValue('cloudBackups.restore.enabled', true, 'boolean'),
        restoreMode: getConfigValue('cloudBackups.restore.mode', 'emptyDataRootOnly'),
    };
}

/**
 * Returns object keys for the archive and the latest manifest.
 * @param {{ prefix?: string }} config Cloud backup config
 * @param {string} timestamp Timestamp suffix
 * @returns {{ archiveKey: string, manifestKey: string }}
 */
export function getCloudBackupObjectKeys(config, timestamp) {
    const prefix = normalizePrefix(config.prefix || DEFAULT_PREFIX);
    return {
        archiveKey: `${prefix}/backups/full-${timestamp}.zip`,
        manifestKey: `${prefix}/latest.json`,
    };
}

/**
 * Returns old full-backup object keys that exceed the configured retention count.
 * @param {{ prefix?: string, keepBackups?: number }} config Cloud backup config
 * @param {string[]} objectKeys Object keys in the bucket
 * @returns {string[]} Object keys to delete
 */
export function getExpiredCloudBackupKeys(config, objectKeys) {
    const keepBackups = Math.max(0, Math.floor(Number(config.keepBackups ?? 7)));
    if (keepBackups <= 0) {
        return [];
    }

    const backupPrefix = `${normalizePrefix(config.prefix || DEFAULT_PREFIX)}/backups/`;
    const fullBackupKeys = objectKeys
        .filter(key => key.startsWith(backupPrefix) && /\/full-\d{8}T\d{6}Z\.zip$/.test(key))
        .sort();

    return fullBackupKeys.slice(0, Math.max(0, fullBackupKeys.length - keepBackups));
}

/**
 * Checks whether the data root is empty enough to safely auto-restore into.
 * @param {string} dataRoot Data root path
 * @returns {boolean}
 */
export function isDataRootEmptyForRestore(dataRoot) {
    if (!fs.existsSync(dataRoot)) {
        return true;
    }

    const entries = fs.readdirSync(dataRoot).filter(entry => !EMPTY_ROOT_IGNORED_ENTRIES.has(entry));
    return entries.length === 0;
}

/**
 * Creates a zip archive containing the full data root contents.
 * @param {string} dataRoot Data root path
 * @param {string} archivePath Target zip path
 * @returns {Promise<void>}
 */
export async function createDataRootArchive(dataRoot, archivePath) {
    await fsPromises.mkdir(path.dirname(archivePath), { recursive: true });

    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(archivePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(dataRoot, false);
        archive.finalize();
    });
}

/**
 * Restores a full data root archive.
 * @param {string} archivePath Source zip path
 * @param {string} dataRoot Data root path
 * @returns {Promise<void>}
 */
export async function restoreDataRootArchive(archivePath, dataRoot) {
    await fsPromises.rm(dataRoot, { recursive: true, force: true });
    await fsPromises.mkdir(dataRoot, { recursive: true });

    await new Promise((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true }, (openError, zipfile) => {
            if (openError) {
                reject(openError);
                return;
            }

            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                extractZipEntry(zipfile, entry, dataRoot)
                    .then(() => zipfile.readEntry())
                    .catch(reject);
            });
            zipfile.on('end', resolve);
            zipfile.on('error', reject);
        });
    });
}

/**
 * Restores cloud backup if enabled and the configured restore mode permits it.
 * @param {string} dataRoot Data root path
 * @returns {Promise<boolean>} Whether a restore happened
 */
export async function restoreFromCloudBackupIfEnabled(dataRoot) {
    const config = getCloudBackupConfig();
    if (!isCloudBackupUsable(config) || !config.restoreEnabled) {
        return false;
    }

    if (config.restoreMode !== 'always' && !isDataRootEmptyForRestore(dataRoot)) {
        console.info('Cloud backup restore skipped: data root is not empty.');
        return false;
    }

    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'st-cloud-restore-'));
    const archivePath = path.join(tempDir, 'restore.zip');

    try {
        const keys = getCloudBackupObjectKeys(config, 'unused');
        const manifest = await downloadJson(config, keys.manifestKey);
        if (!manifest?.archiveKey) {
            console.warn(color.yellow('Cloud backup restore skipped: latest manifest has no archive key.'));
            return false;
        }

        await downloadFile(config, manifest.archiveKey, archivePath);
        await restoreDataRootArchive(archivePath, dataRoot);
        console.info(color.green(`Cloud backup restored from ${manifest.archiveKey}`));
        return true;
    } catch (error) {
        console.error(color.red('Cloud backup restore failed:'), error);
        return false;
    } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
}

/**
 * Runs one full cloud backup now.
 * @param {string} dataRoot Data root path
 * @returns {Promise<boolean>} Whether backup succeeded
 */
export async function runCloudBackupNow(dataRoot) {
    const config = getCloudBackupConfig();
    if (!isCloudBackupUsable(config)) {
        return false;
    }

    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'st-cloud-backup-'));
    const timestamp = createBackupTimestamp();
    const archivePath = path.join(tempDir, `full-${timestamp}.zip`);
    const keys = getCloudBackupObjectKeys(config, timestamp);

    try {
        await createDataRootArchive(dataRoot, archivePath);
        await uploadFile(config, keys.archiveKey, archivePath, 'application/zip');

        const stat = await fsPromises.stat(archivePath);
        const manifest = {
            version: MANIFEST_VERSION,
            createdAt: new Date().toISOString(),
            dataRoot: path.basename(path.resolve(dataRoot)),
            archiveKey: keys.archiveKey,
            size: stat.size,
        };
        await uploadJson(config, keys.manifestKey, manifest);
        await pruneExpiredCloudBackups(config);

        console.info(color.green(`Cloud backup uploaded to s3://${config.bucket}/${keys.archiveKey}`));
        return true;
    } catch (error) {
        console.error(color.red('Cloud backup failed:'), error);
        return false;
    } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
}

/**
 * Starts daily cloud backups after server startup.
 * @param {string} dataRoot Data root path
 * @returns {NodeJS.Timeout|null}
 */
export function startCloudBackupScheduler(dataRoot) {
    const config = getCloudBackupConfig();
    if (!isCloudBackupUsable(config) || !config.scheduleEnabled) {
        return null;
    }

    const intervalMs = Math.max(1, config.intervalHours) * 60 * 60 * 1000;
    const startupDelayMs = Math.max(0, config.startupDelaySeconds) * 1000;

    console.info(`Cloud backups enabled. Full data root snapshots will run every ${config.intervalHours} hour(s).`);

    setTimeout(() => {
        runCloudBackupNow(dataRoot).catch(error => console.error('Cloud backup timer failed:', error));
    }, startupDelayMs).unref();

    const timer = setInterval(() => {
        runCloudBackupNow(dataRoot).catch(error => console.error('Cloud backup timer failed:', error));
    }, intervalMs);
    timer.unref();
    return timer;
}

function normalizePrefix(prefix) {
    return String(prefix || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '') || DEFAULT_PREFIX;
}

/**
 * @param {CloudBackupConfig} config Cloud backup config
 * @returns {boolean}
 */
function isCloudBackupUsable(config) {
    if (!config.enabled) {
        return false;
    }

    const missing = ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'].filter(key => !config[key]);
    if (missing.length > 0) {
        console.warn(color.yellow(`Cloud backups are enabled but missing config: ${missing.join(', ')}`));
        return false;
    }

    return true;
}

function createBackupTimestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function extractZipEntry(zipfile, entry, dataRoot) {
    const targetPath = path.resolve(dataRoot, entry.fileName);
    const safeRoot = path.resolve(dataRoot) + path.sep;
    if (!targetPath.startsWith(safeRoot) && targetPath !== path.resolve(dataRoot)) {
        throw new Error(`Refusing to extract unsafe archive entry: ${entry.fileName}`);
    }

    if (/\/$/.test(entry.fileName)) {
        await fsPromises.mkdir(targetPath, { recursive: true });
        return;
    }

    await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
    await new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (error, readStream) => {
            if (error) {
                reject(error);
                return;
            }

            const writeStream = fs.createWriteStream(targetPath);
            pipeline(readStream, writeStream).then(resolve).catch(reject);
        });
    });
}

async function uploadJson(config, key, payload) {
    await s3Request(config, 'PUT', key, {
        body: JSON.stringify(payload, null, 2),
        contentType: 'application/json',
    });
}

async function downloadJson(config, key) {
    const response = await s3Request(config, 'GET', key);
    return response.json();
}

async function uploadFile(config, key, filePath, contentType) {
    const stat = await fsPromises.stat(filePath);
    await s3Request(config, 'PUT', key, {
        body: fs.createReadStream(filePath),
        contentLength: stat.size,
        contentType,
    });
}

async function downloadFile(config, key, filePath) {
    const response = await s3Request(config, 'GET', key);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(response.body, fs.createWriteStream(filePath));
}

async function pruneExpiredCloudBackups(config) {
    try {
        const backupPrefix = `${normalizePrefix(config.prefix || DEFAULT_PREFIX)}/backups/`;
        const objectKeys = await listObjectKeys(config, backupPrefix);
        const expiredKeys = getExpiredCloudBackupKeys(config, objectKeys);

        await Promise.all(expiredKeys.map(key => deleteObject(config, key)));
        if (expiredKeys.length > 0) {
            console.info(`Cloud backup retention deleted ${expiredKeys.length} old snapshot(s).`);
        }
    } catch (error) {
        console.warn(color.yellow('Cloud backup retention cleanup failed:'), error);
    }
}

async function listObjectKeys(config, prefix) {
    const keys = [];
    let continuationToken = '';

    do {
        const query = {
            'list-type': '2',
            prefix,
        };
        if (continuationToken) {
            query['continuation-token'] = continuationToken;
        }

        const response = await s3Request(config, 'GET', '', { query });
        const xml = await response.text();
        keys.push(...parseS3ListObjectKeys(xml));
        continuationToken = parseS3Tag(xml, 'NextContinuationToken');
    } while (continuationToken);

    return keys;
}

async function deleteObject(config, key) {
    await s3Request(config, 'DELETE', key);
}

function parseS3ListObjectKeys(xml) {
    return Array.from(String(xml || '').matchAll(/<Key>([\s\S]*?)<\/Key>/g), match => decodeXmlText(match[1]));
}

function parseS3Tag(xml, tagName) {
    const match = String(xml || '').match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
    return match ? decodeXmlText(match[1]) : '';
}

function decodeXmlText(text) {
    return String(text || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, '\'')
        .replace(/&amp;/g, '&');
}

async function s3Request(config, method, key, options = {}) {
    const request = buildSignedS3Request(config, method, key, options);
    const response = await fetch(request.url, request.fetchOptions);

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`S3 ${method} ${key} failed with ${response.status}: ${text.slice(0, 500)}`);
    }

    return response;
}

function buildSignedS3Request(config, method, key, options = {}) {
    const endpoint = new URL(config.endpoint);
    const encodedKey = encodeS3Path(key);
    const pathName = config.forcePathStyle
        ? `/${encodeURIComponent(config.bucket)}${encodedKey ? `/${encodedKey}` : ''}`
        : `/${encodedKey}`;
    const queryString = buildCanonicalQueryString(options.query || {});
    const host = config.forcePathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
    const url = `${endpoint.protocol}//${host}${pathName}${queryString ? `?${queryString}` : ''}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = options.body && typeof options.body === 'string'
        ? sha256Hex(options.body)
        : 'UNSIGNED-PAYLOAD';
    const headers = {
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    };

    if (options.contentType) {
        headers['content-type'] = options.contentType;
    }

    if (Number.isFinite(options.contentLength)) {
        headers['content-length'] = String(options.contentLength);
    }

    const sortedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaders.map(header => `${header}:${headers[header]}\n`).join('');
    const signedHeaders = sortedHeaders.join(';');
    const canonicalRequest = [
        method,
        pathName,
        queryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = hmac(getSigningKey(config.secretAccessKey, dateStamp, config.region), stringToSign, 'hex');

    headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        url,
        fetchOptions: {
            method,
            headers,
            body: options.body,
            duplex: options.body && typeof options.body !== 'string' ? 'half' : undefined,
        },
    };
}

function encodeS3Path(key) {
    return String(key).split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function buildCanonicalQueryString(query) {
    return Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [encodeS3QueryPart(key), encodeS3QueryPart(value)])
        .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
}

function encodeS3QueryPart(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
    return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function getSigningKey(secretAccessKey, dateStamp, region) {
    const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = hmac(dateKey, region);
    const dateRegionServiceKey = hmac(dateRegionKey, 's3');
    return hmac(dateRegionServiceKey, 'aws4_request');
}
