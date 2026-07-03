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
});
