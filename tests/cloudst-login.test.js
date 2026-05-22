/* global globalThis */

import crypto from 'node:crypto';
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

function hashPassword(password, salt) {
    return crypto.scryptSync(password.normalize(), salt, 64).toString('base64');
}

function makeTempDataRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-cloudst-login-test-'));
}

async function startServer(app) {
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function createMockCloudSt() {
    const app = express();
    app.use(express.json());
    app.post('/api/internal/sillytavern/verify-login', (req, res) => {
        const secret = req.headers['x-cloudst-secret'];
        if (secret !== CLOUDST_SECRET) {
            return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'invalid secret' });
        }

        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, code: 'BAD_REQUEST', message: 'missing fields' });
        }

        if (username === 'expired') {
            return res.status(403).json({ success: false, code: 'EXPIRED', message: '账号已过期' });
        }
        if (username === 'disabled') {
            return res.status(403).json({ success: false, code: 'DISABLED', message: '账号已禁用' });
        }
        if (username === 'notfound') {
            return res.status(404).json({ success: false, code: 'NOT_FOUND', message: '用户不存在' });
        }
        if (username === 'badpayload') {
            return res.status(200).json({ success: true, user: { handle: 'badpayload', name: 'Bad' } });
        }

        if (username === 'alice' && password === 'pass-alice') {
            const salt = 'salt-alice';
            const passwordHash = hashPassword(password, salt);
            return res.status(200).json({
                success: true,
                user: { handle: 'alice', name: 'Alice', passwordHash, salt, enabled: true, admin: false },
            });
        }

        if (username === 'bob' && password === 'pass-bob') {
            const salt = 'salt-bob';
            const passwordHash = hashPassword(password, salt);
            return res.status(200).json({
                success: true,
                user: { handle: 'bob', name: 'Bob Cloud', passwordHash, salt, enabled: true, admin: true },
            });
        }

        return res.status(401).json({ success: false, code: 'INVALID_PASSWORD', message: '密码错误' });
    });

    return app;
}

describe('cloudST login integration', () => {
    let dataRoot = '';
    let loginServer = null;
    let loginBaseUrl = '';
    let cloudStServer = null;
    let cloudStBaseUrl = '';

    beforeAll(async () => {
        dataRoot = makeTempDataRoot();
        globalThis.DATA_ROOT = dataRoot;
        globalThis.COMMAND_LINE_ARGS = { basicAuthMode: false, whitelistMode: false, listen: false };

        const util = await import('../src/util.js');
        util.setConfigFilePath(CONFIG_PATH);

        const mockCloudSt = await startServer(createMockCloudSt());
        cloudStServer = mockCloudSt.server;
        cloudStBaseUrl = mockCloudSt.baseUrl;

        process.env.SILLYTAVERN_CLOUDST_VERIFYLOGIN_ENABLED = 'true';
        process.env.SILLYTAVERN_CLOUDST_BASEURL = cloudStBaseUrl;
        process.env.SILLYTAVERN_CLOUDST_VERIFYLOGIN_PATH = '/api/internal/sillytavern/verify-login';
        process.env.SILLYTAVERN_CLOUDST_SECRET = CLOUDST_SECRET;

        const users = await import('../src/users.js');
        await users.initUserStorage(dataRoot);

        const usersPublic = await import('../src/endpoints/users-public.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.session = {};
            next();
        });
        app.use('/api/users', usersPublic.router);

        const loginApp = await startServer(app);
        loginServer = loginApp.server;
        loginBaseUrl = loginApp.baseUrl;
    });

    afterAll(async () => {
        if (loginServer) {
            await new Promise((resolve) => loginServer.close(resolve));
        }
        if (cloudStServer) {
            await new Promise((resolve) => cloudStServer.close(resolve));
        }
        delete process.env.SILLYTAVERN_CLOUDST_VERIFYLOGIN_ENABLED;
        delete process.env.SILLYTAVERN_CLOUDST_BASEURL;
        delete process.env.SILLYTAVERN_CLOUDST_VERIFYLOGIN_PATH;
        delete process.env.SILLYTAVERN_CLOUDST_SECRET;
        await storage.clear();
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });

    test('auto creates local user after successful cloudST verify-login', async () => {
        const response = await fetch(`${loginBaseUrl}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'alice', password: 'pass-alice' }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.handle).toBe('alice');

        const user = await storage.getItem('user:alice');
        expect(user).toBeTruthy();
        expect(user.name).toBe('Alice');
        expect(user.enabled).toBe(true);
    });

    test('returns explicit code and message when cloudST denies login', async () => {
        const response = await fetch(`${loginBaseUrl}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'expired', password: 'pass-expired' }),
        });

        expect(response.status).toBe(403);
        const payload = await response.json();
        expect(payload.code).toBe('EXPIRED');
        expect(payload.error).toBe('账号已过期');
    });

    test('syncs local user fields from cloudST user contract', async () => {
        await storage.setItem('user:bob', {
            handle: 'bob',
            name: 'Old Name',
            created: Date.now(),
            password: 'old-hash',
            salt: 'old-salt',
            admin: false,
            enabled: false,
        });

        const response = await fetch(`${loginBaseUrl}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'bob', password: 'pass-bob' }),
        });

        expect(response.status).toBe(200);
        const user = await storage.getItem('user:bob');
        expect(user.name).toBe('Bob Cloud');
        expect(user.admin).toBe(true);
        expect(user.enabled).toBe(true);
        expect(user.salt).toBe('salt-bob');
    });

    test('fails with explicit upstream payload error when hash or salt is missing', async () => {
        const response = await fetch(`${loginBaseUrl}/api/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle: 'badpayload', password: 'pass-bad' }),
        });

        expect(response.status).toBe(502);
        const payload = await response.json();
        expect(payload.code).toBe('UPSTREAM_PAYLOAD_INVALID');
    });
});
