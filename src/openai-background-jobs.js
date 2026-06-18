import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import fetch from 'node-fetch';
import sanitize from 'sanitize-filename';

import { CHAT_COMPLETION_SOURCES } from './constants.js';
import { getChatData, trySaveChat } from './endpoints/chats.js';
import { readSecret, SECRET_KEYS } from './endpoints/secrets.js';
import { tryParse } from './util.js';

const JOB_STATUSES = Object.freeze({
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    APPEND_CONFLICT: 'append_conflict',
});
const TERMINAL_STATUSES = new Set([
    JOB_STATUSES.COMPLETED,
    JOB_STATUSES.FAILED,
    JOB_STATUSES.CANCELLED,
    JOB_STATUSES.APPEND_CONFLICT,
]);
const OPENAI_API = 'https://api.openai.com/v1';

export function hashChatMessage(message) {
    return crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex');
}

export function extractOpenAICompatibleText(data) {
    return data?.choices?.[0]?.delta?.content
        ?? data?.choices?.[0]?.message?.content
        ?? data?.choices?.[0]?.text
        ?? '';
}

export function createAssistantMessage(job) {
    const now = new Date().toISOString();
    const text = job.result.text;
    const extra = {
        api: job.result.api,
        model: job.result.model,
        reasoning: job.result.reasoning || '',
        reasoning_duration: null,
    };
    const message = {
        name: job.chat.characterName,
        is_user: false,
        send_date: now,
        mes: text,
        extra,
        gen_started: job.generationStarted,
        gen_finished: now,
        swipe_id: 0,
        swipes: [text],
        swipe_info: [{
            send_date: now,
            gen_started: job.generationStarted,
            gen_finished: now,
            extra: structuredClone(extra),
        }],
    };
    return message;
}

function getUserHandle(request) {
    return request.user?.profile?.handle || 'default';
}

function getJobsDirectory(user) {
    return path.join(user.directories.root, 'background-generations');
}

function getJobFilePath(user, jobId) {
    return path.join(getJobsDirectory(user), `${sanitize(jobId)}.json`);
}

function getCardName(avatarUrl) {
    return sanitize(String(avatarUrl || '').replace(/\.png$/i, ''));
}

function getChatFilePath(user, chat) {
    const cardName = getCardName(chat.avatarUrl);
    return path.join(user.directories.chats, cardName, sanitize(`${String(chat.fileName)}.jsonl`));
}

function getDuplicateKey(userHandle, chat) {
    return [
        userHandle,
        chat.avatarUrl,
        chat.fileName,
        chat.userMessageIndex,
        chat.userMessageHash,
    ].join('|');
}

function normalizeChatMetadata(body) {
    const chat = body?.chat ?? {};
    return {
        avatarUrl: String(chat.avatar_url ?? chat.avatarUrl ?? ''),
        fileName: String(chat.file_name ?? chat.fileName ?? ''),
        characterName: String(chat.character_name ?? chat.characterName ?? chat.ch_name ?? chat.chName ?? ''),
        userMessageIndex: Number(chat.user_message_index ?? chat.userMessageIndex),
        userMessageHash: String(chat.user_message_hash ?? chat.userMessageHash ?? ''),
    };
}

function getSanitizedPayload(payload) {
    const sanitized = structuredClone(payload || {});
    delete sanitized.proxy_password;
    return sanitized;
}

function createJob(request) {
    const payload = structuredClone(request.body.payload || {});
    const chat = normalizeChatMetadata(request.body);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const api = payload.chat_completion_source || CHAT_COMPLETION_SOURCES.OPENAI;
    return {
        id,
        user: request.user,
        userHandle: getUserHandle(request),
        status: JOB_STATUSES.QUEUED,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        generationStarted: request.body.chat?.generation_started || createdAt,
        chat,
        request: { payload },
        result: {
            text: '',
            reasoning: '',
            model: payload.model || '',
            api,
            error: null,
        },
        acknowledged: false,
        controller: new AbortController(),
        listeners: new Set(),
        duplicateKey: getDuplicateKey(getUserHandle(request), chat),
    };
}

function toClientSnapshot(job) {
    return {
        id: job.id,
        userHandle: job.userHandle,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
        chat: job.chat,
        request: { payload: getSanitizedPayload(job.request.payload) },
        result: job.result,
        acknowledged: job.acknowledged,
    };
}

function persistJob(job) {
    fs.mkdirSync(getJobsDirectory(job.user), { recursive: true });
    fs.writeFileSync(getJobFilePath(job.user, job.id), JSON.stringify(toClientSnapshot(job), null, 2));
}

function writeSse(response, data) {
    response.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function notifyJob(job) {
    const snapshot = toClientSnapshot(job);
    for (const listener of job.listeners) {
        writeSse(listener, snapshot);
        if (TERMINAL_STATUSES.has(job.status)) {
            writeSse(listener, '[DONE]');
            listener.end();
        }
    }
    if (TERMINAL_STATUSES.has(job.status)) {
        job.listeners.clear();
    }
}

function updateJob(job, patch = {}) {
    Object.assign(job, patch);
    job.updatedAt = new Date().toISOString();
    if (TERMINAL_STATUSES.has(job.status)) {
        job.completedAt = job.completedAt || job.updatedAt;
    }
    persistJob(job);
    notifyJob(job);
}

function getExistingDuplicateJob(jobStore, job) {
    for (const existing of jobStore.values()) {
        if (existing.duplicateKey === job.duplicateKey && [JOB_STATUSES.QUEUED, JOB_STATUSES.RUNNING].includes(existing.status)) {
            return existing;
        }
    }
    return null;
}

function validateStartRequest(request, response) {
    if (!request.body?.payload || !request.body?.chat) {
        response.status(400).send({ error: 'Missing payload or chat metadata.' });
        return false;
    }
    const source = request.body.payload.chat_completion_source;
    if (![CHAT_COMPLETION_SOURCES.OPENAI, CHAT_COMPLETION_SOURCES.CUSTOM].includes(source)) {
        response.status(400).send({ error: 'Background jobs only support OpenAI-compatible sources.' });
        return false;
    }
    const chat = normalizeChatMetadata(request.body);
    if (!chat.avatarUrl || !chat.fileName || !Number.isInteger(chat.userMessageIndex) || !chat.userMessageHash) {
        response.status(400).send({ error: 'Invalid chat metadata.' });
        return false;
    }
    return true;
}

function buildProviderRequest(job) {
    const payload = job.request.payload;
    const isOpenAi = payload.chat_completion_source === CHAT_COMPLETION_SOURCES.OPENAI;
    const apiUrl = isOpenAi
        ? new URL(payload.reverse_proxy || OPENAI_API).toString()
        : String(payload.custom_url || '');
    if (!apiUrl) {
        throw new Error('Custom OpenAI-compatible URL is missing.');
    }
    const apiKey = isOpenAi
        ? (payload.reverse_proxy ? payload.proxy_password : readSecret(job.user.directories, SECRET_KEYS.OPENAI))
        : (payload.proxy_password || readSecret(job.user.directories, SECRET_KEYS.CUSTOM) || '');
    const requestBody = {
        messages: payload.messages,
        model: payload.model,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        max_completion_tokens: payload.max_completion_tokens,
        stream: payload.stream,
        presence_penalty: payload.presence_penalty,
        frequency_penalty: payload.frequency_penalty,
        top_p: payload.top_p,
        top_k: payload.top_k,
        stop: payload.stop,
        logit_bias: payload.logit_bias,
        seed: payload.seed,
        n: payload.n,
    };
    return {
        url: `${apiUrl.replace(/\/$/, '')}/chat/completions`,
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(requestBody),
            signal: job.controller.signal,
        },
    };
}

function appendAssistantMessage(job) {
    const chatFilePath = getChatFilePath(job.user, job.chat);
    const chatData = getChatData(chatFilePath);
    const targetMessage = chatData[job.chat.userMessageIndex];
    if (!targetMessage || hashChatMessage(targetMessage) !== job.chat.userMessageHash || chatData.length !== job.chat.userMessageIndex + 1) {
        updateJob(job, { status: JOB_STATUSES.APPEND_CONFLICT });
        return;
    }
    const assistantMessage = createAssistantMessage(job);
    chatData.push(assistantMessage);
    const cardName = getCardName(job.chat.avatarUrl);
    trySaveChat(chatData, chatFilePath, true, job.userHandle, cardName, job.user.directories.backups);
    job.chat.assistantMessageIndex = chatData.length - 1;
    updateJob(job, { status: JOB_STATUSES.COMPLETED });
}

function consumeSseLine(job, line) {
    if (!line.startsWith('data:')) {
        return;
    }
    const rawData = line.slice(5).trim();
    if (!rawData || rawData === '[DONE]') {
        return;
    }
    const parsed = tryParse(rawData);
    if (!parsed) {
        throw new Error(`Unable to parse streaming chunk: ${rawData}`);
    }
    const text = extractOpenAICompatibleText(parsed);
    if (text) {
        job.result.text += text;
        updateJob(job);
    }
}

async function readStreamingResponse(job, response) {
    let buffer = '';
    for await (const chunk of response.body) {
        buffer += Buffer.from(chunk).toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            consumeSseLine(job, line);
        }
    }
    if (buffer) {
        consumeSseLine(job, buffer);
    }
}

async function runJob(job, fetchImpl) {
    updateJob(job, { status: JOB_STATUSES.RUNNING });
    try {
        const { url, init } = buildProviderRequest(job);
        const response = await fetchImpl(url, init);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(response.statusText || text || `Provider returned ${response.status}`);
        }
        if (job.request.payload.stream) {
            await readStreamingResponse(job, response);
        } else {
            const json = await response.json();
            job.result.text += extractOpenAICompatibleText(json);
            updateJob(job);
        }
        if (job.status !== JOB_STATUSES.CANCELLED) {
            appendAssistantMessage(job);
        }
    } catch (error) {
        if (job.status === JOB_STATUSES.CANCELLED) {
            updateJob(job);
            return;
        }
        job.result.error = error?.message || 'Unknown generation error';
        updateJob(job, { status: JOB_STATUSES.FAILED });
    }
}

function getJobForRequest(request, jobStore, jobId) {
    const job = jobStore.get(jobId);
    if (!job || job.userHandle !== getUserHandle(request)) {
        return null;
    }
    return job;
}

export function createOpenAIBackgroundJobsRouter({ fetchImpl = fetch } = {}) {
    const router = express.Router();
    const jobStore = new Map();

    router.post('/start', (request, response) => {
        if (!validateStartRequest(request, response)) {
            return;
        }
        const job = createJob(request);
        const duplicate = getExistingDuplicateJob(jobStore, job);
        if (duplicate) {
            return response.send({ jobId: duplicate.id, status: duplicate.status });
        }
        jobStore.set(job.id, job);
        persistJob(job);
        setImmediate(() => runJob(job, fetchImpl));
        return response.send({ jobId: job.id, status: job.status });
    });

    router.get('/active', (request, response) => {
        const avatarUrl = String(request.query.avatar_url || '');
        const fileName = String(request.query.file_name || '');
        const activeJobs = Array.from(jobStore.values())
            .filter(job => job.userHandle === getUserHandle(request))
            .filter(job => !job.acknowledged)
            .filter(job => job.chat.avatarUrl === avatarUrl && job.chat.fileName === fileName)
            .map(toClientSnapshot);
        return response.send({ jobs: activeJobs });
    });

    router.get('/:jobId', (request, response) => {
        const job = getJobForRequest(request, jobStore, request.params.jobId);
        if (!job) {
            return response.sendStatus(404);
        }
        return response.send(toClientSnapshot(job));
    });

    router.get('/:jobId/stream', (request, response) => {
        const job = getJobForRequest(request, jobStore, request.params.jobId);
        if (!job) {
            return response.sendStatus(404);
        }
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        writeSse(response, toClientSnapshot(job));
        if (TERMINAL_STATUSES.has(job.status)) {
            writeSse(response, '[DONE]');
            response.end();
            return;
        }
        job.listeners.add(response);
        request.on('close', () => {
            job.listeners.delete(response);
        });
    });

    router.post('/:jobId/cancel', (request, response) => {
        const job = getJobForRequest(request, jobStore, request.params.jobId);
        if (!job) {
            return response.sendStatus(404);
        }
        if (!TERMINAL_STATUSES.has(job.status)) {
            job.controller.abort();
            updateJob(job, { status: JOB_STATUSES.CANCELLED });
        }
        return response.send({ ok: true, status: job.status });
    });

    router.post('/:jobId/ack', (request, response) => {
        const job = getJobForRequest(request, jobStore, request.params.jobId);
        if (!job) {
            return response.sendStatus(404);
        }
        job.acknowledged = true;
        updateJob(job);
        return response.send({ ok: true });
    });

    return router;
}
