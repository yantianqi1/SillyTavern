import {
    chat,
    characters,
    getGenerationStarted,
    getGeneratingApi,
    getGeneratingModel,
    getRequestHeaders,
    reloadCurrentChat,
    saveChat,
    this_chid,
} from '../script.js';
import { selected_group } from './group-chats.js';
import { getEventSourceStream } from './sse-stream.js';
import { sha256Text } from './sha256.js';

const START_JOB_ENDPOINT = '/api/backends/chat-completions/jobs/start';
const ACTIVE_JOBS_ENDPOINT = '/api/backends/chat-completions/jobs/active';
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'append_conflict']);
const WATCHED_JOB_IDS = new Set();

export let activeOpenAIBackgroundJobId = null;

function getActiveCharacter() {
    return this_chid !== undefined && this_chid !== null ? characters[this_chid] : null;
}

function canStreamSingleChoice(generateData) {
    return Boolean(generateData?.stream)
        && Number(generateData?.n ?? 1) <= 1
        && !Array.isArray(generateData?.tools)
        && !Array.isArray(generateData?.functions);
}

function parseJobSnapshot(rawData) {
    if (!rawData || rawData === '[DONE]') {
        return null;
    }

    return JSON.parse(rawData);
}

function isTerminalJob(job) {
    return TERMINAL_JOB_STATUSES.has(job?.status);
}

function getJobEndpoint(jobId) {
    return `/api/backends/chat-completions/jobs/${jobId}`;
}

function getJobStreamEndpoint(jobId) {
    return `/api/backends/chat-completions/jobs/${jobId}/stream`;
}

function getJobCancelEndpoint(jobId) {
    return `/api/backends/chat-completions/jobs/${jobId}/cancel`;
}

function getJobAckEndpoint(jobId) {
    return `/api/backends/chat-completions/jobs/${jobId}/ack`;
}

async function openJobStream(jobId) {
    const response = await fetch(getJobStreamEndpoint(jobId), {
        headers: getRequestHeaders(),
    });
    if (!response.ok || !response.body) {
        throw new Error(`Background generation stream failed: ${response.status}`);
    }

    const eventStream = getEventSourceStream();
    response.body.pipeThrough(eventStream);
    return eventStream.readable.getReader();
}

async function fetchJobSnapshot(jobId) {
    const response = await fetch(getJobEndpoint(jobId), {
        headers: getRequestHeaders(),
    });
    if (!response.ok) {
        return null;
    }

    return await response.json();
}

async function handleRecoveredJob(job) {
    if (!job?.id) {
        return;
    }

    if (job.status === 'completed') {
        await ackOpenAIBackgroundJob(job.id);
        await reloadCurrentChat();
        return;
    }

    if (isTerminalJob(job)) {
        await ackOpenAIBackgroundJob(job.id);
        return;
    }

    activeOpenAIBackgroundJobId = job.id;
}

async function watchOpenAIBackgroundJob(jobId) {
    if (WATCHED_JOB_IDS.has(jobId)) {
        return;
    }

    WATCHED_JOB_IDS.add(jobId);
    try {
        const reader = await openJobStream(jobId);
        let lastSnapshot = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            if (value.data === '[DONE]') {
                break;
            }

            lastSnapshot = parseJobSnapshot(value.data);
            await handleRecoveredJob(lastSnapshot);
            if (isTerminalJob(lastSnapshot)) {
                return;
            }
        }

        const finalSnapshot = lastSnapshot && isTerminalJob(lastSnapshot) ? lastSnapshot : await fetchJobSnapshot(jobId);
        await handleRecoveredJob(finalSnapshot);
    } catch (error) {
        console.warn('OpenAI background generation recovery failed', error);
    } finally {
        WATCHED_JOB_IDS.delete(jobId);
    }
}

export function canUseOpenAIBackgroundGeneration(type, generateData) {
    const character = getActiveCharacter();
    const lastMessage = chat[chat.length - 1];
    const source = generateData?.chat_completion_source;
    return type === 'normal'
        && !selected_group
        && Boolean(character?.chat)
        && Boolean(lastMessage?.is_user)
        && canStreamSingleChoice(generateData)
        && ['openai', 'custom'].includes(source);
}

export async function buildOpenAIBackgroundMetadata() {
    const character = getActiveCharacter();
    const userMessageIndex = chat.length - 1;
    const userMessage = chat[userMessageIndex];
    return {
        avatar_url: character.avatar,
        file_name: character.chat,
        ch_name: character.name,
        character_name: character.name,
        user_message_index: userMessageIndex + 1,
        user_message_hash: await sha256Text(JSON.stringify(userMessage)),
        generation_started: getGenerationStarted()?.toISOString?.() ?? new Date().toISOString(),
        api: getGeneratingApi(),
        model: getGeneratingModel(),
    };
}

export async function startOpenAIBackgroundJob(generateData) {
    await saveChat({ mesId: chat.length - 1 });
    const response = await fetch(START_JOB_ENDPOINT, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            payload: generateData,
            chat: await buildOpenAIBackgroundMetadata(),
        }),
    });
    if (!response.ok) {
        throw new Error(`Background generation failed to start: ${response.status}`);
    }

    const job = await response.json();
    activeOpenAIBackgroundJobId = job.jobId;
    return job;
}

export async function ackOpenAIBackgroundJob(jobId) {
    await fetch(getJobAckEndpoint(jobId), {
        method: 'POST',
        headers: getRequestHeaders(),
    });
    if (activeOpenAIBackgroundJobId === jobId) {
        activeOpenAIBackgroundJobId = null;
    }
}

export async function cancelOpenAIBackgroundJob() {
    if (!activeOpenAIBackgroundJobId) {
        return false;
    }

    await fetch(getJobCancelEndpoint(activeOpenAIBackgroundJobId), {
        method: 'POST',
        headers: getRequestHeaders(),
    });
    activeOpenAIBackgroundJobId = null;
    return true;
}

export async function recoverOpenAIBackgroundJobs() {
    const character = getActiveCharacter();
    if (selected_group || !character?.chat) {
        return;
    }

    const params = new URLSearchParams({
        avatar_url: character.avatar,
        file_name: character.chat,
    });
    const response = await fetch(`${ACTIVE_JOBS_ENDPOINT}?${params}`, {
        headers: getRequestHeaders(),
    });
    if (!response.ok) {
        return;
    }

    const payload = await response.json();
    for (const job of payload.jobs ?? []) {
        await handleRecoveredJob(job);
        if (!isTerminalJob(job)) {
            watchOpenAIBackgroundJob(job.id);
        }
    }
}

export async function sendOpenAIBackgroundRequest(type, generateData, canMultiSwipe) {
    if (!canUseOpenAIBackgroundGeneration(type, generateData)) {
        throw new Error('OpenAI background generation is not available for this request.');
    }

    const { jobId } = await startOpenAIBackgroundJob(generateData);
    const reader = await openJobStream(jobId);
    return async function* streamData() {
        let lastText = '';
        let lastJob = null;
        const swipes = [];
        const toolCalls = [];
        const state = { reasoning: '', images: [], signature: '', toolSignatures: {} };
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (isTerminalJob(lastJob)) {
                    await ackOpenAIBackgroundJob(jobId);
                    return;
                }

                throw new Error('Background generation stream ended before completion.');
            }

            if (value.data === '[DONE]') {
                await ackOpenAIBackgroundJob(jobId);
                return;
            }

            const job = parseJobSnapshot(value.data);
            lastJob = job;
            if (job?.status === 'failed') {
                throw new Error(job.result?.error || 'Background generation failed.');
            }
            if (job?.status === 'cancelled') {
                return;
            }

            lastText = job?.result?.text ?? lastText;
            state.reasoning = job?.result?.reasoning ?? '';
            yield { text: lastText, swipes: canMultiSwipe ? swipes : [], logprobs: null, toolCalls, state };
        }
    };
}
