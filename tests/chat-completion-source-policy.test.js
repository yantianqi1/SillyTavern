import { describe, expect, test } from '@jest/globals';

import {
    normalizeDisabledChatCompletionSources,
    isSourceDisabled,
} from '../src/chat-completion-source-policy.js';

describe('chat completion source policy', () => {
    test('normalizes configured disabled sources', () => {
        const result = normalizeDisabledChatCompletionSources(['dreamer', ' openai ', 'dreamer']);

        expect(result).toEqual(['dreamer', 'openai']);
    });

    test('rejects malformed disabled source configuration', () => {
        expect(() => normalizeDisabledChatCompletionSources('dreamer')).toThrow('apiConnections.disabledChatCompletionSources must be an array');
        expect(() => normalizeDisabledChatCompletionSources(['dreamer', ''])).toThrow('must contain non-empty strings');
    });

    test('checks whether a source is disabled', () => {
        expect(isSourceDisabled('dreamer', ['dreamer'])).toBe(true);
        expect(isSourceDisabled('openai', ['dreamer'])).toBe(false);
    });
});
