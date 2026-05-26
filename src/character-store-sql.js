export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS store_cards (
    id TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    format TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_mtime_ms REAL NOT NULL,
    source_size INTEGER NOT NULL,
    summary_mtime_ms REAL NOT NULL,
    tag_mtime_ms REAL NOT NULL DEFAULT 0,
    tag_size INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS store_card_tags (
    card_id TEXT NOT NULL REFERENCES store_cards(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES store_tags(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (card_id, tag_id)
);

CREATE TABLE IF NOT EXISTS store_card_errors (
    relative_path TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_store_cards_category ON store_cards(category);
CREATE INDEX IF NOT EXISTS idx_store_cards_name ON store_cards(name);
CREATE INDEX IF NOT EXISTS idx_store_cards_sort ON store_cards(category COLLATE NOCASE, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_store_tags_name ON store_tags(name);
CREATE INDEX IF NOT EXISTS idx_store_card_tags_tag_id ON store_card_tags(tag_id);
`;

export const UPSERT_CARD_SQL = `
INSERT INTO store_cards (
    id,
    relative_path,
    name,
    category,
    format,
    summary,
    source_mtime_ms,
    source_size,
    summary_mtime_ms,
    tag_mtime_ms,
    tag_size,
    updated_at
) VALUES (
    @id,
    @relativePath,
    @name,
    @category,
    @format,
    @summary,
    @sourceMtimeMs,
    @sourceSize,
    @summaryMtimeMs,
    @tagMtimeMs,
    @tagSize,
    @updatedAt
)
ON CONFLICT(id) DO UPDATE SET
    relative_path = excluded.relative_path,
    name = excluded.name,
    category = excluded.category,
    format = excluded.format,
    summary = excluded.summary,
    source_mtime_ms = excluded.source_mtime_ms,
    source_size = excluded.source_size,
    summary_mtime_ms = excluded.summary_mtime_ms,
    tag_mtime_ms = excluded.tag_mtime_ms,
    tag_size = excluded.tag_size,
    updated_at = excluded.updated_at
`;
