import { describe, expect, test } from '@jest/globals';

import {
    filterStoreCards,
    getHiddenStoreTagCount,
    getStoreCardTagsDisplay,
    getStoreCardSummaryDisplay,
    getStorePageWindow,
    getStoreTagStats,
    getVisibleStoreTagStats,
    pruneStorePageCache,
    prepareStoreCards,
} from '../public/scripts/character-store.js';

const COLLAPSED_TAG_ROW_LIMIT = 10;

const CARDS = [
    {
        category: 'space/pilots',
        name: 'Astra',
        summary: 'Navigator and scout.',
        tags: ['Sci-Fi', 'Navigator'],
    },
    {
        category: 'fantasy',
        name: 'Lyra',
        summary: 'Archivist of maps.',
        tags: ['Fantasy', 'Archivist'],
    },
];

function makeRankedTagCards(totalTags) {
    return Array.from({ length: totalTags }, (_card, cardIndex) => ({
        tags: Array.from(
            { length: totalTags - cardIndex },
            (_tag, tagIndex) => `Tag ${tagIndex + 1}`,
        ),
    }));
}

describe('character store UI helpers', () => {
    test('filters cards by search and tags regardless of category', () => {
        const result = filterStoreCards(CARDS, {
            search: 'nav',
            category: 'fantasy',
            tags: ['Sci-Fi'],
        });

        expect(result).toEqual([CARDS[0]]);
    });

    test('hides card summaries by default', () => {
        expect(getStoreCardSummaryDisplay(CARDS[0])).toBe('');
        expect(getStoreCardSummaryDisplay(CARDS[0], { showSummary: true })).toBe('Navigator and scout.');
    });

    test('prepares cards for tag display and fast filtering without mutating inputs', () => {
        const prepared = prepareStoreCards(CARDS);

        expect(prepared).not.toBe(CARDS);
        expect(prepared[0]).toEqual(expect.objectContaining({
            searchText: 'astra space/pilots navigator and scout. sci-fi navigator',
            tagSet: new Set(['Sci-Fi', 'Navigator']),
        }));
        expect(CARDS[0]).not.toHaveProperty('tagSet');
        expect(getStoreCardTagsDisplay(prepared[0])).toEqual(['Sci-Fi', 'Navigator']);
        expect(filterStoreCards(prepared, { tags: ['Navigator'] })).toEqual([prepared[0]]);
    });

    test('keeps collapsed tag preview to one row of top-ranked tags', () => {
        const totalTags = COLLAPSED_TAG_ROW_LIMIT + 3;
        const selectedTag = `Tag ${totalTags}`;
        const tagStats = getStoreTagStats(makeRankedTagCards(totalTags));
        const visibleStats = getVisibleStoreTagStats({
            tagStats,
            selectedTags: new Set([selectedTag]),
        });
        const expectedPreview = Array.from(
            { length: COLLAPSED_TAG_ROW_LIMIT },
            (_value, index) => `Tag ${index + 1}`,
        );

        expect(tagStats.slice(0, 3)).toEqual([
            { name: 'Tag 1', count: totalTags },
            { name: 'Tag 2', count: totalTags - 1 },
            { name: 'Tag 3', count: totalTags - 2 },
        ]);
        expect(visibleStats.map(tagStat => tagStat.name)).toEqual(expectedPreview);
        expect(visibleStats).toHaveLength(COLLAPSED_TAG_ROW_LIMIT);
        expect(visibleStats.map(tagStat => tagStat.name)).not.toContain(selectedTag);
        expect(getHiddenStoreTagCount(tagStats, visibleStats)).toBe(totalTags - COLLAPSED_TAG_ROW_LIMIT);
        expect(getVisibleStoreTagStats({ tagStats, expanded: true })).toEqual(tagStats);
    });

    test('keeps pagination buttons and cache to a three page window', () => {
        expect(getStorePageWindow({ page: 1, totalPages: 9 })).toEqual([1, 2, 3]);
        expect(getStorePageWindow({ page: 5, totalPages: 9 })).toEqual([4, 5, 6]);
        expect(getStorePageWindow({ page: 9, totalPages: 9 })).toEqual([7, 8, 9]);

        const cache = new Map([
            [1, [CARDS[0]]],
            [2, [CARDS[1]]],
            [3, []],
            [4, []],
        ]);
        const pruned = pruneStorePageCache(cache, [2, 3, 4]);

        expect([...pruned.keys()]).toEqual([2, 3, 4]);
        expect([...cache.keys()]).toEqual([1, 2, 3, 4]);
    });
});
