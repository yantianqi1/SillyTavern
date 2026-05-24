import { getConfigValue } from './util.js';

export const DISABLED_CHAT_COMPLETION_SOURCES_CONFIG_KEY = 'apiConnections.disabledChatCompletionSources';

/**
 * Normalizes the configured list of disabled chat completion source IDs.
 * @param {unknown} value Config value
 * @returns {string[]} Normalized source IDs
 */
export function normalizeDisabledChatCompletionSources(value) {
    if (!Array.isArray(value)) {
        throw new TypeError(`${DISABLED_CHAT_COMPLETION_SOURCES_CONFIG_KEY} must be an array`);
    }

    const normalized = value.map(source => {
        if (typeof source !== 'string' || source.trim() === '') {
            throw new TypeError(`${DISABLED_CHAT_COMPLETION_SOURCES_CONFIG_KEY} must contain non-empty strings`);
        }

        return source.trim().toLowerCase();
    });

    return [...new Set(normalized)];
}

/**
 * Reads disabled chat completion source IDs from config.yaml.
 * @returns {string[]} Disabled source IDs
 */
export function getDisabledChatCompletionSources() {
    const value = getConfigValue(DISABLED_CHAT_COMPLETION_SOURCES_CONFIG_KEY, []);
    return normalizeDisabledChatCompletionSources(value);
}

/**
 * Checks if a source ID is disabled.
 * @param {unknown} source Source ID
 * @param {string[]} disabledSources Disabled source IDs
 * @returns {boolean} True when source is disabled
 */
export function isSourceDisabled(source, disabledSources) {
    if (typeof source !== 'string') {
        return false;
    }

    return disabledSources.includes(source.trim().toLowerCase());
}

/**
 * Checks if a chat completion source is disabled in config.yaml.
 * @param {unknown} source Source ID
 * @returns {boolean} True when source is disabled
 */
export function isChatCompletionSourceDisabled(source) {
    return isSourceDisabled(source, getDisabledChatCompletionSources());
}

/**
 * Builds the client-visible source policy payload.
 * @returns {{disabledChatCompletionSources: string[]}} Source policy
 */
export function getChatCompletionSourcePolicy() {
    return {
        disabledChatCompletionSources: getDisabledChatCompletionSources(),
    };
}
