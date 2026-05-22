/* global globalThis */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import storage from 'node-persist';
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function makeTempDataRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-public-registration-test-'));
}

async function startServer(app) {
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('public user registration', () => {
    let dataRoot = '';
    let server = null;
    let baseUrl = '';
    let lastSession = null;
    let consoleSpies = [];

    beforeAll(async () => {
        consoleSpies = ['log', 'info', 'warn'].map(method => jest.spyOn(console, method).mockImplementation(() => {}));
        dataRoot = makeTempDataRoot();
        globalThis.DATA_ROOT = dataRoot;
        globalThis.COMMAND_LINE_ARGS = { basicAuthMode: false, whitelistMode: false, listen: false };

        process.env.SILLYTAVERN_ENABLEUSERACCOUNTS = 'true';
        process.env.SILLYTAVERN_ENABLEPUBLICUSERREGISTRATION = 'true';

        const util = await import('../src/util.js');
        util.setConfigFilePath(path.join(repoRoot, 'default/config.yaml'));

        const users = await import('../src/users.js');
        await users.initUserStorage(dataRoot);

        const usersPublic = await import('../src/endpoints/users-public.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.session = {};
            lastSession = req.session;
            next();
        });
        app.use('/api/users', usersPublic.router);

        const appServer = await startServer(app);
        server = appServer.server;
        baseUrl = appServer.baseUrl;
    });

    beforeEach(async () => {
        process.env.SILLYTAVERN_ENABLEPUBLICUSERREGISTRATION = 'true';
        lastSession = null;
        await storage.clear();
    });

    afterAll(async () => {
        for (const spy of consoleSpies) {
            spy.mockRestore();
        }
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        delete process.env.SILLYTAVERN_ENABLEUSERACCOUNTS;
        delete process.env.SILLYTAVERN_ENABLEPUBLICUSERREGISTRATION;
        await storage.clear();
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });

    test('registers a regular enabled user and logs them in', async () => {
        const response = await fetch(`${baseUrl}/api/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'alice', name: 'Alice', password: 'pass-alice' }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ handle: 'alice' });
        expect(lastSession.handle).toBe('alice');

        const user = await storage.getItem('user:alice');
        expect(user).toBeTruthy();
        expect(user.name).toBe('Alice');
        expect(user.enabled).toBe(true);
        expect(user.admin).toBe(false);
        expect(user.password).toBeTruthy();
        expect(user.password).not.toBe('pass-alice');
    });

    test('rejects duplicate handles', async () => {
        await storage.setItem('user:taken', {
            handle: 'taken',
            name: 'Taken',
            created: Date.now(),
            password: 'hash',
            salt: 'salt',
            admin: false,
            enabled: true,
        });

        const response = await fetch(`${baseUrl}/api/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'taken', password: 'new-pass' }),
        });

        expect(response.status).toBe(409);
    });

    test('rejects missing passwords', async () => {
        const response = await fetch(`${baseUrl}/api/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'nopass' }),
        });

        expect(response.status).toBe(400);
    });

    test('rejects registration when public registration is disabled', async () => {
        process.env.SILLYTAVERN_ENABLEPUBLICUSERREGISTRATION = 'false';

        const response = await fetch(`${baseUrl}/api/users/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'blocked', password: 'pass-blocked' }),
        });

        expect(response.status).toBe(403);
    });
});
