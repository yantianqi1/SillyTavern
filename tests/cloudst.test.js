/* global globalThis */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import storage from 'node-persist';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

const CLOUDST_SECRET = 'test-cloudst-secret';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(repoRoot, 'default/config.yaml');

function makeTempDataRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-cloudst-test-'));
}

function createSessionMiddleware() {
    return (_req, _res, next) => next();
}

async function startServer(app) {
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
        server,
        baseUrl: `http://127.0.0.1:${port}`,
    };
}

describe('cloudST management router', () => {
    let dataRoot = '';
    let server = null;
    let baseUrl = '';

    beforeAll(async () => {
        process.env.SILLYTAVERN_CLOUDST_SECRET = CLOUDST_SECRET;
        dataRoot = makeTempDataRoot();
        globalThis.DATA_ROOT = dataRoot;
        globalThis.COMMAND_LINE_ARGS = { basicAuthMode: false, whitelistMode: false, listen: false };

        const util = await import('../src/util.js');
        util.setConfigFilePath(CONFIG_PATH);

        const users = await import('../src/users.js');
        await users.initUserStorage(dataRoot);

        const cloudstEndpoint = await import('../src/endpoints/cloudst.js');

        const app = express();
        app.use(express.json());
        app.use(createSessionMiddleware());
        app.use('/api/cloudst', cloudstEndpoint.router);

        const started = await startServer(app);
        server = started.server;
        baseUrl = started.baseUrl;
    });

    afterAll(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await storage.clear();
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
        delete process.env.SILLYTAVERN_CLOUDST_SECRET;
    });

    test('rejects requests without shared secret', async () => {
        const response = await fetch(`${baseUrl}/api/cloudst/users/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(response.status).toBe(401);
        const payload = await response.json();
        expect(payload.error).toBeTruthy();
    });

    test('supports upsert/list/delete with shared secret', async () => {
        const upsertRes = await fetch(`${baseUrl}/api/cloudst/users/upsert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-cloudst-secret': CLOUDST_SECRET,
            },
            body: JSON.stringify({
                handle: 'alice',
                name: 'Alice',
                passwordHash: 'hash-1',
                salt: 'salt-1',
                enabled: true,
                admin: false,
            }),
        });

        expect(upsertRes.status).toBe(200);
        const upsertPayload = await upsertRes.json();
        expect(upsertPayload.success).toBe(true);
        expect(upsertPayload.user.handle).toBe('alice');

        const listRes = await fetch(`${baseUrl}/api/cloudst/users/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-cloudst-secret': CLOUDST_SECRET,
            },
            body: JSON.stringify({}),
        });

        expect(listRes.status).toBe(200);
        const listPayload = await listRes.json();
        const alice = listPayload.users.find((x) => x.handle === 'alice');
        expect(alice).toBeTruthy();
        expect(alice.name).toBe('Alice');

        const userRoot = path.join(dataRoot, 'alice');
        expect(fs.existsSync(userRoot)).toBe(true);

        const deleteRes = await fetch(`${baseUrl}/api/cloudst/users/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-cloudst-secret': CLOUDST_SECRET,
            },
            body: JSON.stringify({ handle: 'alice', purge: true }),
        });

        expect(deleteRes.status).toBe(200);
        const deletePayload = await deleteRes.json();
        expect(deletePayload.success).toBe(true);
        expect(fs.existsSync(userRoot)).toBe(false);
    });
});
