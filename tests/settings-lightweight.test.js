import { describe, expect, test } from '@jest/globals';

import {
    LIGHTWEIGHT_SETTINGS_DEFERRED_KEYS,
    buildSettingsTextForScope,
} from '../src/settings-scope.js';

describe('lightweight settings payloads', () => {
    test('startup scope removes heavy deferred settings while preserving core chat settings', () => {
        const settingsText = JSON.stringify({
            username: 'tianyuan',
            main_api: 'openai',
            active_character: 'Seraphina.png',
            extension_settings: {
                disabledExtensions: ['heavy-extension'],
                __userscripts: {
                    large_profile: 'x'.repeat(1000),
                },
            },
            oai_settings: {
                chat_completion_source: 'custom',
                custom_url: 'https://example.test/v1',
                prompts: [{ content: 'x'.repeat(1000) }],
                extensions: {
                    tavern_helper: {
                        scripts: [{ content: 'y'.repeat(1000) }],
                    },
                },
            },
        });

        const result = buildSettingsTextForScope(settingsText, 'startup');
        const settings = JSON.parse(result.settings);

        expect(result.deferred_settings_keys).toEqual(LIGHTWEIGHT_SETTINGS_DEFERRED_KEYS);
        expect(settings.username).toBe('tianyuan');
        expect(settings.main_api).toBe('openai');
        expect(settings.active_character).toBe('Seraphina.png');
        expect(settings.extension_settings).toBeUndefined();
        expect(settings.oai_settings.chat_completion_source).toBe('custom');
        expect(settings.oai_settings.custom_url).toBe('https://example.test/v1');
        expect(settings.oai_settings.prompts).toBeUndefined();
        expect(settings.oai_settings.extensions).toBeUndefined();
    });

    test('full scope preserves the original settings text', () => {
        const settingsText = JSON.stringify({
            username: 'tianyuan',
            extension_settings: { disabledExtensions: ['heavy-extension'] },
            oai_settings: {
                prompts: [{ content: 'prompt' }],
                extensions: { tavern_helper: { scripts: [] } },
            },
        }, null, 4);

        const result = buildSettingsTextForScope(settingsText, 'full');

        expect(result.settings).toBe(settingsText);
        expect(result.deferred_settings_keys).toEqual([]);
    });
});
