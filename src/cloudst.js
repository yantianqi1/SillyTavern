import fs from 'node:fs/promises';

import storage from 'node-persist';
import { checkForNewContent } from './endpoints/content-manager.js';
import {
    KEY_PREFIX,
    ensurePublicDirectoriesExist,
    getUserDirectories,
    toKey,
} from './users.js';
import { DEFAULT_USER } from './constants.js';
import { getConfigValue } from './util.js';

const DEFAULT_VERIFY_LOGIN_PATH = '/api/internal/sillytavern/verify-login';
const CODE_UNAUTHORIZED = 'UNAUTHORIZED';
const CODE_UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE';
const CODE_UPSTREAM_PAYLOAD_INVALID = 'UPSTREAM_PAYLOAD_INVALID';
export const CLOUDST_SECRET_HEADER = 'x-cloudst-secret';

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
}

function readPlainEnv(key) {
    return firstDefined(process.env[key]);
}

function getConfigString(configKey, envKey, fallback = '') {
    return String(firstDefined(readPlainEnv(envKey), getConfigValue(configKey, fallback), fallback)).trim();
}

function getConfigBoolean(configKey, envKey, fallback = false) {
    const plainEnv = readPlainEnv(envKey);
    if (plainEnv !== undefined) {
        return toBoolean(plainEnv, fallback);
    }
    return toBoolean(getConfigValue(configKey, fallback, 'boolean'), fallback);
}

function normalizeHandle(rawHandle) {
    const handle = String(rawHandle ?? '').trim();
    if (!handle) {
        throw createCloudStError(400, 'INVALID_HANDLE', 'Missing handle');
    }
    if (handle.includes(':')) {
        throw createCloudStError(400, 'INVALID_HANDLE', 'Handle cannot contain ":"');
    }
    return handle;
}

function normalizeUserContract(rawUser, fallbackHandle) {
    if (!rawUser || typeof rawUser !== 'object') {
        throw createCloudStError(502, CODE_UPSTREAM_PAYLOAD_INVALID, 'CloudST response missing user contract');
    }
    const handle = normalizeHandle(firstDefined(rawUser.handle, fallbackHandle));
    const name = String(firstDefined(rawUser.name, handle));
    const passwordHash = String(firstDefined(rawUser.passwordHash, ''));
    const salt = String(firstDefined(rawUser.salt, ''));
    if (!passwordHash || !salt) {
        throw createCloudStError(502, CODE_UPSTREAM_PAYLOAD_INVALID, 'CloudST response missing passwordHash or salt');
    }
    return {
        handle,
        name,
        passwordHash,
        salt,
        enabled: toBoolean(rawUser.enabled, true),
        admin: toBoolean(rawUser.admin, false),
    };
}

function normalizeSharedSecret(request) {
    const header = typeof request.get === 'function'
        ? request.get(CLOUDST_SECRET_HEADER)
        : request.headers?.get?.(CLOUDST_SECRET_HEADER);
    return String(firstDefined(header, '')).trim();
}

function withDefaultStatus(status) {
    return Number.isInteger(status) && status > 0 ? status : 500;
}

export function createCloudStError(status, code, message) {
    const error = new Error(message);
    error.status = withDefaultStatus(status);
    error.code = String(firstDefined(code, 'INTERNAL_ERROR'));
    return error;
}

export function toCloudStErrorPayload(error) {
    const status = withDefaultStatus(error?.status);
    const code = String(firstDefined(error?.code, 'INTERNAL_ERROR'));
    const message = String(firstDefined(error?.message, 'Unexpected cloudST error'));
    return { status, body: { error: message, code } };
}

function getVerifyErrorStatus(upstreamStatus) {
    if ([400, 401, 403, 404, 429].includes(upstreamStatus)) {
        return upstreamStatus;
    }
    return 502;
}

function normalizeLocalUserInput(rawInput) {
    const handle = normalizeHandle(rawInput?.handle);
    const name = String(firstDefined(rawInput?.name, handle));
    const passwordHash = String(firstDefined(rawInput?.passwordHash, ''));
    const salt = String(firstDefined(rawInput?.salt, ''));
    if ((passwordHash && !salt) || (!passwordHash && salt)) {
        throw createCloudStError(400, 'INVALID_PASSWORD_STATE', 'passwordHash and salt must be provided together');
    }
    return {
        handle,
        name,
        passwordHash,
        salt,
        enabled: toBoolean(rawInput?.enabled, true),
        admin: toBoolean(rawInput?.admin, false),
        created: Number(firstDefined(rawInput?.created, Date.now())),
    };
}

function getCloudStSettings() {
    const baseUrl = getConfigString('cloudst.baseUrl', 'CLOUDST_BASE_URL', '');
    return {
        secret: getConfigString('cloudst.secret', 'CLOUDST_SECRET', ''),
        baseUrl,
        verifyLoginPath: getConfigString('cloudst.verifyLogin.path', 'CLOUDST_VERIFY_LOGIN_PATH', DEFAULT_VERIFY_LOGIN_PATH),
        verifyLoginEnabled: getConfigBoolean('cloudst.verifyLogin.enabled', 'CLOUDST_VERIFY_LOGIN_ENABLED', Boolean(baseUrl)),
    };
}

function getVerifyLoginUrl(settings) {
    try {
        return new URL(settings.verifyLoginPath, settings.baseUrl).toString();
    } catch {
        throw createCloudStError(500, 'CLOUDST_CONFIG_INVALID', 'Invalid cloudST baseUrl or verifyLogin.path');
    }
}

export function isCloudStVerifyLoginEnabled() {
    return getCloudStSettings().verifyLoginEnabled;
}

export function verifyCloudStRequest(request) {
    const settings = getCloudStSettings();
    const incomingSecret = normalizeSharedSecret(request);
    return Boolean(settings.secret) && incomingSecret === settings.secret;
}

export function requireCloudStSecret(request, response, next) {
    if (!verifyCloudStRequest(request)) {
        return response.status(401).json({
            error: 'Unauthorized cloudST request',
            code: CODE_UNAUTHORIZED,
        });
    }
    return next();
}

export async function upsertCloudStUser(input) {
    const normalized = normalizeLocalUserInput(input);
    const existingUser = await storage.getItem(toKey(normalized.handle));
    const createdAt = existingUser?.created ?? normalized.created;
    const user = {
        handle: normalized.handle,
        name: normalized.name,
        created: createdAt,
        password: normalized.passwordHash,
        salt: normalized.salt,
        admin: normalized.admin,
        enabled: normalized.enabled,
    };
    await storage.setItem(toKey(normalized.handle), user);
    await ensurePublicDirectoriesExist();
    if (!existingUser) {
        const directories = getUserDirectories(normalized.handle);
        await checkForNewContent([directories]);
    }
    return { created: !existingUser, user };
}

export async function deleteCloudStUser(input) {
    const handle = normalizeHandle(input?.handle);
    const purge = toBoolean(input?.purge, false);
    await storage.removeItem(toKey(handle));
    if (purge) {
        const directories = getUserDirectories(handle);
        await fs.rm(directories.root, { recursive: true, force: true });
    }
}

export async function listCloudStUsers() {
    /** @type {import('./users.js').User[]} */
    const users = await storage.values((item) => item.key.startsWith(KEY_PREFIX));
    return users.filter((user) => user.handle !== DEFAULT_USER.handle).map((user) => ({
        handle: user.handle,
        name: user.name,
        enabled: user.enabled,
        admin: user.admin,
        created: user.created,
    }));
}

export async function verifyCloudStLogin(input, fetchImpl = fetch) {
    const settings = getCloudStSettings();
    if (!settings.verifyLoginEnabled) {
        return null;
    }
    if (!settings.secret || !settings.baseUrl) {
        throw createCloudStError(500, 'CLOUDST_CONFIG_INVALID', 'cloudST verify-login configuration is incomplete');
    }

    const url = getVerifyLoginUrl(settings);
    const payload = {
        username: String(firstDefined(input?.username, '')),
        password: String(firstDefined(input?.password, '')),
    };

    let response;
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [CLOUDST_SECRET_HEADER]: settings.secret,
            },
            body: JSON.stringify(payload),
        });
    } catch {
        throw createCloudStError(502, CODE_UPSTREAM_UNAVAILABLE, 'cloudST verify-login endpoint is unavailable');
    }

    let responseBody = {};
    try {
        responseBody = await response.json();
    } catch {
        responseBody = {};
    }

    if (!response.ok || !responseBody.success) {
        const message = String(firstDefined(responseBody.message, responseBody.error, 'External authentication failed'));
        const code = String(firstDefined(responseBody.code, 'EXTERNAL_AUTH_FAILED'));
        throw createCloudStError(getVerifyErrorStatus(response.status), code, message);
    }

    return normalizeUserContract(responseBody.user, payload.username);
}

export async function authenticateCloudStLogin(handle, password, fetchImpl = fetch) {
    const existingUser = await storage.getItem(toKey(handle));
    const verifiedUser = await verifyCloudStLogin({ username: handle, password }, fetchImpl);
    const syncedUser = await upsertCloudStUser({
        ...verifiedUser,
        created: existingUser?.created ?? Date.now(),
    });
    return syncedUser.user;
}
