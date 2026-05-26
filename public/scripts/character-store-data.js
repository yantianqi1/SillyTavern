export const STORE_TAG_PREVIEW_LIMIT = 10;
export const STORE_PAGE_SIZE = 60;
export const STORE_PAGE_WINDOW_SIZE = 3;

export function filterStoreCards(cards, { search = '', tags = [] } = {}) {
    const query = search.trim().toLowerCase();
    return cards.filter(card => cardMatches(card, { query, tags }));
}

export function prepareStoreCards(cards) {
    return cards.map(card => {
        const tags = getStoreCardTagsDisplay(card);
        const preparedCard = { ...card, tags };
        return {
            ...preparedCard,
            searchText: buildSearchText(preparedCard),
            tagSet: new Set(tags),
        };
    });
}

export function getStoreCardSummaryDisplay(card, { showSummary = false } = {}) {
    if (!showSummary) {
        return '';
    }
    return String(card?.summary || '').trim();
}

export function getStoreCardTagsDisplay(card) {
    return Array.isArray(card?.tags)
        ? card.tags.map(tag => String(tag).trim()).filter(Boolean)
        : [];
}

export function getStoreTagStats(cards) {
    const counts = new Map();
    for (const card of cards) {
        for (const tag of new Set(getStoreCardTagsDisplay(card))) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort(compareTagStats);
}

export function getVisibleStoreTagStats({
    tagStats = [],
    expanded = false,
    limit = STORE_TAG_PREVIEW_LIMIT,
} = {}) {
    if (expanded) {
        return [...tagStats];
    }

    return tagStats.slice(0, limit);
}

export function getHiddenStoreTagCount(tagStats = [], visibleTagStats = []) {
    return Math.max(tagStats.length - visibleTagStats.length, 0);
}

export function getStorePageWindow({
    page = 1,
    totalPages = 1,
    windowSize = STORE_PAGE_WINDOW_SIZE,
} = {}) {
    const size = Math.max(1, windowSize);
    const lastPage = Math.max(1, totalPages);
    const currentPage = Math.min(Math.max(1, page), lastPage);
    const halfWindow = Math.floor(size / 2);
    const maxStart = Math.max(1, lastPage - size + 1);
    const start = Math.min(Math.max(1, currentPage - halfWindow), maxStart);
    const end = Math.min(lastPage, start + size - 1);
    return Array.from({ length: end - start + 1 }, (_value, index) => start + index);
}

export function pruneStorePageCache(pageCache, pageWindow) {
    const allowedPages = new Set(pageWindow);
    return new Map([...pageCache.entries()].filter(([page]) => allowedPages.has(page)));
}

function cardMatches(card, { query, tags }) {
    if (tags.length && !cardHasTags(card, tags)) {
        return false;
    }
    if (!query) {
        return true;
    }
    return getSearchText(card).includes(query);
}

function getSearchText(card) {
    if (typeof card?.searchText === 'string') {
        return card.searchText;
    }
    return buildSearchText(card);
}

function buildSearchText(card) {
    return [card.name, card.category, card.summary, ...getStoreCardTagsDisplay(card)]
        .join(' ')
        .toLowerCase();
}

function cardHasTags(card, tags) {
    const tagSet = card?.tagSet instanceof Set ? card.tagSet : new Set(getStoreCardTagsDisplay(card));
    return tags.every(tag => tagSet.has(tag));
}

function compareTagStats(left, right) {
    return right.count - left.count || left.name.localeCompare(right.name);
}
