const DEFAULT_STORE_PAGE_SIZE = 60;
const FIRST_PAGE = 1;
const LIKE_ESCAPE = '\\';

export function normalizeStoreListOptions(options = {}) {
    return {
        page: normalizePositiveInteger(options.page, FIRST_PAGE),
        pageSize: normalizePositiveInteger(options.pageSize ?? options.page_size, DEFAULT_STORE_PAGE_SIZE),
        search: String(options.search || '').trim(),
        tags: normalizeTags(options.tags),
    };
}

export function listStoreFromDatabase(db, options = {}) {
    const normalized = normalizeStoreListOptions(options);
    const filter = buildStoreFilter(normalized);
    const total = getStoreTotal(db, filter);
    const cards = getStoreCards(db, filter, normalized);
    const tagsByCardId = getTagsByCardIds(db, cards.map(card => card.id));
    const hydratedCards = cards.map(card => hydrateStoreCard(card, tagsByCardId));
    const tagStats = getStoreTagStats(db, filter);

    return {
        cards: hydratedCards,
        categories: getStoreCategories(db, filter),
        errors: getStoreErrors(db),
        pagination: getPagination(normalized, total),
        tags: tagStats.map(tag => tag.name),
        tagStats,
    };
}

export function getTagsByCardIds(db, cardIds) {
    if (cardIds.length === 0) {
        return new Map();
    }
    const placeholders = cardIds.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT ct.card_id, t.name
        FROM store_card_tags ct
        JOIN store_tags t ON t.id = ct.tag_id
        WHERE ct.card_id IN (${placeholders})
        ORDER BY ct.card_id, ct.sort_order
    `).all(...cardIds);
    return groupTagRows(rows);
}

export function hydrateStoreCard(card, tagsByCardId) {
    return {
        id: card.id,
        category: card.category,
        format: card.format,
        name: card.name,
        relativePath: card.relative_path,
        summary: card.summary,
        tags: tagsByCardId.get(card.id) ?? [],
    };
}

function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return [...new Set(tags.map(tag => String(tag).trim()).filter(Boolean))];
}

function buildStoreFilter({ search, tags }) {
    const clauses = [];
    const params = [];
    if (search) {
        clauses.push(getSearchClause());
        params.push(...getSearchParams(search));
    }
    for (const tag of tags) {
        clauses.push(getTagClause());
        params.push(tag);
    }
    return {
        params,
        whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    };
}

function getSearchClause() {
    return `(
        LOWER(c.name) LIKE ? ESCAPE '${LIKE_ESCAPE}'
        OR LOWER(c.category) LIKE ? ESCAPE '${LIKE_ESCAPE}'
        OR LOWER(c.summary) LIKE ? ESCAPE '${LIKE_ESCAPE}'
        OR EXISTS (
            SELECT 1
            FROM store_card_tags sct
            JOIN store_tags st ON st.id = sct.tag_id
            WHERE sct.card_id = c.id AND LOWER(st.name) LIKE ? ESCAPE '${LIKE_ESCAPE}'
        )
    )`;
}

function getSearchParams(search) {
    const like = `%${escapeLike(search.toLowerCase())}%`;
    return [like, like, like, like];
}

function getTagClause() {
    return `EXISTS (
        SELECT 1
        FROM store_card_tags fct
        JOIN store_tags ft ON ft.id = fct.tag_id
        WHERE fct.card_id = c.id AND ft.name = ?
    )`;
}

function escapeLike(value) {
    return value.replace(/[\\%_]/g, match => `${LIKE_ESCAPE}${match}`);
}

function getStoreTotal(db, filter) {
    const row = db.prepare(`SELECT COUNT(*) AS total FROM store_cards c ${filter.whereSql}`)
        .get(...filter.params);
    return row?.total ?? 0;
}

function getStoreCards(db, filter, { page, pageSize }) {
    return db.prepare(`
        SELECT c.*
        FROM store_cards c
        ${filter.whereSql}
        ORDER BY c.category COLLATE NOCASE, c.name COLLATE NOCASE
        LIMIT ? OFFSET ?
    `).all(...filter.params, pageSize, (page - 1) * pageSize);
}

function getStoreTagStats(db, filter) {
    return db.prepare(`
        SELECT t.name AS name, COUNT(DISTINCT c.id) AS count
        FROM store_cards c
        JOIN store_card_tags ct ON ct.card_id = c.id
        JOIN store_tags t ON t.id = ct.tag_id
        ${filter.whereSql}
        GROUP BY t.name
        ORDER BY count DESC, t.name COLLATE NOCASE
    `).all(...filter.params);
}

function getStoreCategories(db, filter) {
    const rows = db.prepare(`
        SELECT DISTINCT c.category AS category
        FROM store_cards c
        ${filter.whereSql}
        ORDER BY c.category COLLATE NOCASE
    `).all(...filter.params);
    return rows.map(row => row.category).filter(Boolean);
}

function getStoreErrors(db) {
    return db.prepare(`
        SELECT relative_path AS relativePath, message
        FROM store_card_errors
        ORDER BY relative_path COLLATE NOCASE
    `).all();
}

function getPagination({ page, pageSize }, total) {
    return {
        page,
        pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
    };
}

function groupTagRows(rows) {
    const tagsByCardId = new Map();
    for (const row of rows) {
        const tags = tagsByCardId.get(row.card_id) ?? [];
        tags.push(row.name);
        tagsByCardId.set(row.card_id, tags);
    }
    return tagsByCardId;
}
