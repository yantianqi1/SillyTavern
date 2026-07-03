import fs from 'node:fs';

import { describe, expect, test } from '@jest/globals';

const mainScript = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');

function getFirstLoadInitBody() {
    const start = mainScript.indexOf('async function firstLoadInit()');
    const end = mainScript.indexOf('async function fixViewport()', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return mainScript.slice(start, end);
}

function getGetSettingsBody() {
    const start = mainScript.indexOf('export async function getSettings(');
    const end = mainScript.indexOf('//MARK: saveSettings()', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return mainScript.slice(start, end);
}

describe('startup loader', () => {
    test('loads independent first-run resources concurrently', () => {
        const initBody = getFirstLoadInitBody();
        const concurrentResources = [
            'getUserAvatars(true, user_avatar)',
            'getCharacters()',
            'getBackgrounds()',
            'initTokenizers()',
        ];
        const promiseAllStart = initBody.indexOf('await Promise.all([');
        const promiseAllEnd = initBody.indexOf(']);', promiseAllStart);

        expect(promiseAllStart).toBeGreaterThanOrEqual(0);
        expect(promiseAllEnd).toBeGreaterThan(promiseAllStart);

        const promiseAllBlock = initBody.slice(promiseAllStart, promiseAllEnd);
        for (const resource of concurrentResources) {
            expect(promiseAllBlock).toContain(resource);
        }

        expect(initBody).not.toMatch(/await getUserAvatars\(true,\s*user_avatar\);\s*await getCharacters\(\);\s*await getBackgrounds\(\);\s*await initTokenizers\(\);/s);
    });

    test('releases the gear loader before optional scraper setup', () => {
        const initBody = getFirstLoadInitBody();
        const hideLoaderIndex = initBody.indexOf('await initLoaderHandle.hide()');
        const fixViewportIndex = initBody.indexOf('await fixViewport()');
        const initScrapersIndex = initBody.indexOf('await initScrapers()');
        const appReadyIndex = initBody.indexOf('await eventSource.emit(event_types.APP_READY)');

        expect(hideLoaderIndex).toBeGreaterThanOrEqual(0);
        expect(fixViewportIndex).toBeGreaterThan(hideLoaderIndex);
        expect(initScrapersIndex).toBeGreaterThan(fixViewportIndex);
        expect(appReadyIndex).toBeGreaterThan(initScrapersIndex);
    });

    test('loads startup settings before full deferred settings', () => {
        const settingsBody = getGetSettingsBody();
        const startupFetchIndex = settingsBody.indexOf('fetchSettings(\'startup\')');
        const deferredFetchIndex = settingsBody.indexOf('loadDeferredSettings(data');
        const readyIndex = settingsBody.indexOf('settingsReady = true');

        expect(startupFetchIndex).toBeGreaterThanOrEqual(0);
        expect(deferredFetchIndex).toBeGreaterThan(startupFetchIndex);
        expect(readyIndex).toBeGreaterThan(deferredFetchIndex);
    });

    test('keeps settings blocked when deferred settings fail', () => {
        const settingsBody = getGetSettingsBody();
        const failedDeferredIndex = settingsBody.indexOf('if (!deferredSettingsLoaded)');
        const readyIndex = settingsBody.indexOf('settingsReady = true', failedDeferredIndex);
        const failedDeferredBranch = settingsBody.slice(failedDeferredIndex, readyIndex);

        expect(failedDeferredIndex).toBeGreaterThanOrEqual(0);
        expect(readyIndex).toBeGreaterThan(failedDeferredIndex);
        expect(failedDeferredBranch).toContain('return;');
    });
});
