/* global globalThis */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function makeTempDataRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-openai-bg-test-'));
}

function writeJsonl(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n'));
}

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function hashMessage(message) {
    return crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex');
}

async function waitForStatus(baseUrl, jobId, expectedStatus) {
    const deadline = Date.now() + 5000;
    let lastStatus = '';
    while (Date.now() < deadline) {
        const status = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/${jobId}`);
        lastStatus = (await status.json()).status;
        if (lastStatus === expectedStatus) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Expected job ${jobId} to reach ${expectedStatus}, last status was ${lastStatus}`);
}

async function startServer(app) {
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function startStreamingProvider({ chunks = ['Hello', ' from provider'], holdOpen = false } = {}) {
    let requestCount = 0;
    let lastAbortSeen = false;
    let pendingResponse = null;
    const app = http.createServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
            res.writeHead(404);
            res.end();
            return;
        }
        requestCount += 1;
        req.on('aborted', () => {
            lastAbortSeen = true;
        });
        const body = await new Promise(resolve => {
            const parts = [];
            req.on('data', chunk => parts.push(chunk));
            req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
        });
        const payload = JSON.parse(body);
        if (payload.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.on('close', () => {
                if (holdOpen && pendingResponse === res) {
                    lastAbortSeen = true;
                }
            });
            for (const chunk of chunks) {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
            }
            if (holdOpen) {
                pendingResponse = res;
                return;
            }
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: chunks.join('') } }], model: payload.model }));
        }
    });
    const { server, baseUrl } = await startServer(app);
    return {
        server,
        baseUrl,
        get requestCount() { return requestCount; },
        get lastAbortSeen() { return lastAbortSeen; },
        finish() {
            pendingResponse?.write('data: [DONE]\n\n');
            pendingResponse?.end();
            pendingResponse = null;
        },
    };
}

function createUser(dataRoot) {
    const root = path.join(dataRoot, 'User');
    const chats = path.join(root, 'chats');
    const backups = path.join(root, 'backups');
    fs.mkdirSync(chats, { recursive: true });
    fs.mkdirSync(backups, { recursive: true });
    return {
        profile: { handle: 'User' },
        directories: { root, chats, backups },
    };
}

function createChatFixture(user) {
    const header = { chat_metadata: { integrity: crypto.randomUUID() }, user_name: 'unused', character_name: 'unused' };
    const userMessage = { name: 'User', is_user: true, send_date: '2026-06-18T00:00:00.000Z', mes: 'Hi', extra: {} };
    const filePath = path.join(user.directories.chats, 'char', 'chat.jsonl');
    writeJsonl(filePath, [header, userMessage]);
    return { filePath, userMessage, userMessageHash: hashMessage(userMessage) };
}

async function createApp(user, router) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use('/api/backends/chat-completions/jobs', router);
    return startServer(app);
}

function createStartBody(providerBaseUrl, fixture) {
    return {
        payload: {
            chat_completion_source: 'custom',
            custom_url: `${providerBaseUrl}/v1`,
            proxy_password: 'test',
            model: 'test-model',
            stream: true,
            messages: [{ role: 'user', content: 'Hi' }],
        },
        chat: {
            avatar_url: 'char.png',
            file_name: 'chat',
            ch_name: 'Character',
            character_name: 'Character',
            user_message_index: 1,
            user_message_hash: fixture.userMessageHash,
        },
    };
}

describe('OpenAI background generation jobs', () => {
    let dataRoot = '';
    let servers = [];

    beforeAll(async () => {
        process.env.SILLYTAVERN_BACKUPS_CHAT_ENABLED = 'false';
        const util = await import('../src/util.js');
        util.setConfigFilePath(path.join(repoRoot, 'config.yaml'));
    });

    beforeEach(() => {
        dataRoot = makeTempDataRoot();
        globalThis.DATA_ROOT = dataRoot;
        servers = [];
    });

    afterEach(async () => {
        for (const server of servers) {
            await new Promise(resolve => server.close(resolve));
        }
        if (dataRoot) {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        delete process.env.SILLYTAVERN_BACKUPS_CHAT_ENABLED;
    });

    test('starts a streaming job and appends the completed assistant message to the chat', async () => {
        const provider = await startStreamingProvider();
        servers.push(provider.server);
        const user = createUser(dataRoot);
        const fixture = createChatFixture(user);
        const { createOpenAIBackgroundJobsRouter } = await import('../src/openai-background-jobs.js');
        const { server, baseUrl } = await createApp(user, createOpenAIBackgroundJobsRouter());
        servers.push(server);

        const response = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createStartBody(provider.baseUrl, fixture)),
        });

        expect(response.status).toBe(200);
        const { jobId } = await response.json();
        expect(jobId).toBeTruthy();

        await waitForStatus(baseUrl, jobId, 'completed');

        const rows = readJsonl(fixture.filePath);
        expect(rows).toHaveLength(3);
        expect(rows[2]).toMatchObject({
            name: 'Character',
            is_user: false,
            mes: 'Hello from provider',
            extra: { api: 'custom', model: 'test-model' },
            swipe_id: 0,
        });
        expect(rows[2].swipes).toEqual(['Hello from provider']);
    });

    test('returns the same running job for duplicate starts on the same chat tail', async () => {
        const provider = await startStreamingProvider({ holdOpen: true });
        servers.push(provider.server);
        const user = createUser(dataRoot);
        const fixture = createChatFixture(user);
        const { createOpenAIBackgroundJobsRouter } = await import('../src/openai-background-jobs.js');
        const { server, baseUrl } = await createApp(user, createOpenAIBackgroundJobsRouter());
        servers.push(server);
        const requestBody = createStartBody(provider.baseUrl, fixture);

        const first = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        const second = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        const firstPayload = await first.json();
        const secondPayload = await second.json();
        expect(firstPayload.jobId).toBe(secondPayload.jobId);
        expect(provider.requestCount).toBe(1);
        provider.finish();
        await waitForStatus(baseUrl, firstPayload.jobId, 'completed');
    });

    test('marks append_conflict when the target chat tail changed', async () => {
        const provider = await startStreamingProvider();
        servers.push(provider.server);
        const user = createUser(dataRoot);
        const fixture = createChatFixture(user);
        const rows = readJsonl(fixture.filePath);
        rows.push({ name: 'User', is_user: true, send_date: '2026-06-18T00:00:01.000Z', mes: 'Different tail', extra: {} });
        writeJsonl(fixture.filePath, rows);
        const { createOpenAIBackgroundJobsRouter } = await import('../src/openai-background-jobs.js');
        const { server, baseUrl } = await createApp(user, createOpenAIBackgroundJobsRouter());
        servers.push(server);

        const response = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createStartBody(provider.baseUrl, fixture)),
        });

        const { jobId } = await response.json();
        await waitForStatus(baseUrl, jobId, 'append_conflict');
        expect(readJsonl(fixture.filePath)).toHaveLength(3);
    });

    test('active lookup returns unacknowledged current-chat jobs and ack hides them', async () => {
        const provider = await startStreamingProvider();
        servers.push(provider.server);
        const user = createUser(dataRoot);
        const fixture = createChatFixture(user);
        const { createOpenAIBackgroundJobsRouter } = await import('../src/openai-background-jobs.js');
        const { server, baseUrl } = await createApp(user, createOpenAIBackgroundJobsRouter());
        servers.push(server);
        const start = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createStartBody(provider.baseUrl, fixture)),
        });
        const { jobId } = await start.json();
        await waitForStatus(baseUrl, jobId, 'completed');

        const active = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/active?avatar_url=char.png&file_name=chat`);
        expect((await active.json()).jobs.map(job => job.id)).toContain(jobId);

        const ack = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/${jobId}/ack`, { method: 'POST' });
        expect(ack.status).toBe(200);
        const afterAck = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/active?avatar_url=char.png&file_name=chat`);
        expect((await afterAck.json()).jobs).toHaveLength(0);
    });

    test('cancel aborts a running upstream request and marks the job cancelled', async () => {
        const provider = await startStreamingProvider({ holdOpen: true });
        servers.push(provider.server);
        const user = createUser(dataRoot);
        const fixture = createChatFixture(user);
        const { createOpenAIBackgroundJobsRouter } = await import('../src/openai-background-jobs.js');
        const { server, baseUrl } = await createApp(user, createOpenAIBackgroundJobsRouter());
        servers.push(server);

        const start = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createStartBody(provider.baseUrl, fixture)),
        });
        const { jobId } = await start.json();
        await waitForStatus(baseUrl, jobId, 'running');

        const cancel = await fetch(`${baseUrl}/api/backends/chat-completions/jobs/${jobId}/cancel`, { method: 'POST' });
        expect(cancel.status).toBe(200);
        await waitForStatus(baseUrl, jobId, 'cancelled');
        expect(provider.lastAbortSeen).toBe(true);
    });
});
