export const SETTINGS_SCOPE_STARTUP = 'startup';

export const LIGHTWEIGHT_SETTINGS_DEFERRED_KEYS = [
    'extension_settings',
    'oai_settings.extensions',
    'oai_settings.prompts',
];

/**
 * Builds a settings payload for the requested loading scope.
 * @param {string} settingsText Raw settings JSON text.
 * @param {string} scope Requested settings scope.
 * @returns {{settings: string, deferred_settings_keys: string[]}}
 */
export function buildSettingsTextForScope(settingsText, scope = 'full') {
    if (scope !== SETTINGS_SCOPE_STARTUP) {
        return {
            settings: settingsText,
            deferred_settings_keys: [],
        };
    }

    let settings;
    try {
        settings = JSON.parse(settingsText);
    } catch {
        return {
            settings: settingsText,
            deferred_settings_keys: [],
        };
    }

    delete settings.extension_settings;

    if (settings.oai_settings && typeof settings.oai_settings === 'object') {
        delete settings.oai_settings.extensions;
        delete settings.oai_settings.prompts;
    }

    return {
        settings: JSON.stringify(settings),
        deferred_settings_keys: LIGHTWEIGHT_SETTINGS_DEFERRED_KEYS,
    };
}

/**
 * Gets the requested settings scope from an Express request.
 * @param {import('express').Request} request Express request.
 * @returns {string}
 */
export function getSettingsScope(request) {
    return String(request.body?.scope || request.query?.scope || 'full');
}
