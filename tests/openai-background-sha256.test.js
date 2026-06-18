import crypto from 'node:crypto';

import { describe, expect, test } from '@jest/globals';

import { fallbackSha256Text } from '../public/scripts/sha256.js';

function nodeSha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

describe('OpenAI background generation SHA-256 fallback', () => {
    const cases = [
        '',
        'abc',
        JSON.stringify({ name: 'User', is_user: true, mes: '你好 🌙' }),
    ];

    for (const text of cases) {
        test(`matches Node SHA-256 for ${JSON.stringify(text)}`, () => {
            expect(fallbackSha256Text(text)).toBe(nodeSha256(text));
        });
    }
});
