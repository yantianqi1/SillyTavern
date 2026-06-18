import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
    return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

describe('OpenAI background generation frontend integration', () => {
    test('defines a frontend helper that calls background job endpoints', () => {
        const helper = readRepoFile('public/scripts/openai-background-jobs.js');
        const sha256 = readRepoFile('public/scripts/sha256.js');
        expect(helper).toContain('/api/backends/chat-completions/jobs/start');
        expect(helper).toContain('/api/backends/chat-completions/jobs/active');
        expect(helper).toContain('/api/backends/chat-completions/jobs/${jobId}/stream');
        expect(helper).toContain('/api/backends/chat-completions/jobs/${jobId}/cancel');
        expect(sha256).toContain('fallbackSha256Text');
        expect(helper).toContain('recoverOpenAIBackgroundJobs');
        expect(helper).toContain('Background generation stream ended before completion.');
    });

    test('OpenAI request path imports and uses the background job helper', () => {
        const openai = readRepoFile('public/scripts/openai.js');
        expect(openai).toContain('from \'./openai-background-jobs.js\'');
        expect(openai).toContain('sendOpenAIBackgroundRequest');
    });

    test('main script exports generation metadata and registers recovery hooks', () => {
        const script = readRepoFile('public/script.js');
        expect(script).toContain('export function getGenerationStarted');
        expect(script).toContain('recoverOpenAIBackgroundJobs');
        expect(script).toContain('event_types.CHAT_LOADED');
        expect(script).toContain('visibilitychange');
    });
});
