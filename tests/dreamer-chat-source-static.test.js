import fs from 'node:fs';
import YAML from 'yaml';
import { describe, expect, test } from '@jest/globals';

const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const openAiScript = fs.readFileSync(new URL('../public/scripts/openai.js', import.meta.url), 'utf8');
const settingsEndpoint = fs.readFileSync(new URL('../src/endpoints/settings.js', import.meta.url), 'utf8');
const backendScript = fs.readFileSync(new URL('../src/endpoints/backends/chat-completions.js', import.meta.url), 'utf8');
const defaultConfig = fs.readFileSync(new URL('../default/config.yaml', import.meta.url), 'utf8');
const dockerConfig = fs.readFileSync(new URL('../docker/config/config.yaml', import.meta.url), 'utf8');

const defaultConfigYaml = YAML.parse(defaultConfig);
const dockerConfigYaml = YAML.parse(dockerConfig);

describe('Dreamer chat completion frontend source', () => {
    test('has a Docker config switch that disables Dreamer by source id', () => {
        expect(defaultConfigYaml.apiConnections.disabledChatCompletionSources).toEqual([]);
        expect(dockerConfigYaml.apiConnections.disabledChatCompletionSources).toContain('dreamer');
        expect(dockerConfig).toContain('禁用的聊天补全来源');
    });

    test('exposes disabled chat completion sources to the frontend settings payload', () => {
        expect(settingsEndpoint).toContain('getChatCompletionSourcePolicy');
        expect(settingsEndpoint).toContain('clientConfig');
        expect(settingsEndpoint).toContain('apiConnections');
    });

    test('frontend hides disabled sources and moves stale selections to an enabled source', () => {
        expect(indexHtml).not.toContain('<option value="dreamer">梦想家</option>');
        expect(openAiScript).toContain('applyDisabledChatCompletionSources');
        expect(openAiScript).toContain('normalizeChatCompletionSourceSelection');
        expect(openAiScript).toContain('disabledChatCompletionSources');
    });

    test('backend rejects disabled chat completion sources explicitly', () => {
        expect(backendScript).toContain('isChatCompletionSourceDisabled');
        expect(backendScript).toContain('sendDisabledChatCompletionSourceError');
        expect(backendScript).toContain('is disabled by server config');
    });
});
