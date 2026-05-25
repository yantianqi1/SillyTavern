import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import { SCHEMA_SQL, UPSERT_CARD_SQL } from './character-store-sql.js';

const DATABASE_FILE = 'character-store.sqlite';

export function getCharacterStoreDatabasePath(dataRoot = globalThis.DATA_ROOT) {
    return path.join(dataRoot, DATABASE_FILE);
}

export async function openCharacterStoreIndex(dbPath) {
    await fsPromises.mkdir(path.dirname(dbPath), { recursive: true });
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA_SQL);
    ensureSchemaMigrations(db);
    return new CharacterStoreIndex(db);
}

async function loadSqlite() {
    try {
        return await import('node:sqlite');
    } catch (error) {
        throw new Error(`Character store SQL index requires Node.js sqlite support: ${error.message}`);
    }
}

class CharacterStoreIndex {
    constructor(db) {
        this.db = db;
    }

    close() {
        this.db.close();
    }

    getFileSnapshot(relativePath) {
        return this.db.prepare(`
            SELECT source_mtime_ms, source_size, summary_mtime_ms, tag_mtime_ms, tag_size
            FROM store_cards
            WHERE relative_path = ?
        `).get(relativePath);
    }

    getCardById(cardId) {
        const card = this.db.prepare('SELECT * FROM store_cards WHERE id = ?').get(cardId);
        return card ? hydrateCard(card, this.getTagsByCardIds([card.id])) : null;
    }

    listStore() {
        const cards = this.db.prepare(`
            SELECT * FROM store_cards
            ORDER BY category COLLATE NOCASE, name COLLATE NOCASE
        `).all();
        const tagsByCardId = this.getTagsByCardIds(cards.map(card => card.id));
        const hydratedCards = cards.map(card => hydrateCard(card, tagsByCardId));
        return {
            cards: hydratedCards,
            categories: uniqueSorted(hydratedCards.map(card => card.category).filter(Boolean)),
            errors: this.listErrors(),
            tags: uniqueSorted(hydratedCards.flatMap(card => card.tags)),
        };
    }

    applySync({ cards, currentRelativePaths, errors = [] }) {
        this.db.exec('BEGIN');
        try {
            this.deleteMissingCards(currentRelativePaths);
            this.deleteErroredCards(errors);
            cards.forEach(card => this.upsertCard(card));
            this.deleteUnusedTags();
            this.replaceErrors(errors);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    deleteMissingCards(currentRelativePaths) {
        if (currentRelativePaths.length === 0) {
            this.db.prepare('DELETE FROM store_cards').run();
            return;
        }
        const placeholders = currentRelativePaths.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM store_cards WHERE relative_path NOT IN (${placeholders})`)
            .run(...currentRelativePaths);
    }

    deleteErroredCards(errors) {
        for (const error of errors) {
            this.db.prepare('DELETE FROM store_cards WHERE relative_path = ?').run(error.relativePath);
        }
    }

    upsertCard(card) {
        this.db.prepare(UPSERT_CARD_SQL).run({
            id: card.id,
            relativePath: card.relativePath,
            name: card.name,
            category: card.category,
            format: card.format,
            summary: card.summary,
            sourceMtimeMs: card.sourceMtimeMs,
            sourceSize: card.sourceSize,
            summaryMtimeMs: card.summaryMtimeMs,
            tagMtimeMs: card.tagMtimeMs,
            tagSize: card.tagSize,
            updatedAt: new Date().toISOString(),
        });
        this.replaceCardTags(card.id, card.tags);
        this.db.prepare('DELETE FROM store_card_errors WHERE relative_path = ?').run(card.relativePath);
    }

    replaceCardTags(cardId, tags) {
        const deleteTags = this.db.prepare('DELETE FROM store_card_tags WHERE card_id = ?');
        const insertTag = this.db.prepare('INSERT OR IGNORE INTO store_tags(name) VALUES (?)');
        const selectTag = this.db.prepare('SELECT id FROM store_tags WHERE name = ?');
        const insertCardTag = this.db.prepare(`
            INSERT INTO store_card_tags(card_id, tag_id, sort_order)
            VALUES (?, ?, ?)
        `);
        const insertedTags = new Set();
        deleteTags.run(cardId);
        for (const [sortOrder, tag] of tags.entries()) {
            if (insertedTags.has(tag)) {
                continue;
            }
            insertTag.run(tag);
            const row = selectTag.get(tag);
            insertCardTag.run(cardId, row.id, sortOrder);
            insertedTags.add(tag);
        }
    }

    deleteUnusedTags() {
        this.db.prepare(`
            DELETE FROM store_tags
            WHERE id NOT IN (SELECT tag_id FROM store_card_tags)
        `).run();
    }

    getTagsByCardIds(cardIds) {
        if (cardIds.length === 0) {
            return new Map();
        }
        const placeholders = cardIds.map(() => '?').join(',');
        const rows = this.db.prepare(`
            SELECT ct.card_id, t.name
            FROM store_card_tags ct
            JOIN store_tags t ON t.id = ct.tag_id
            WHERE ct.card_id IN (${placeholders})
            ORDER BY ct.card_id, ct.sort_order
        `).all(...cardIds);
        return groupTagRows(rows);
    }

    replaceErrors(errors) {
        const paths = errors.map(error => error.relativePath);
        this.deleteMissingErrors(paths);
        for (const error of errors) {
            this.db.prepare(`
                INSERT INTO store_card_errors(relative_path, message, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(relative_path) DO UPDATE SET
                    message = excluded.message,
                    updated_at = excluded.updated_at
            `).run(error.relativePath, error.message, new Date().toISOString());
        }
    }

    deleteMissingErrors(paths) {
        if (paths.length === 0) {
            this.db.prepare('DELETE FROM store_card_errors').run();
            return;
        }
        const placeholders = paths.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM store_card_errors WHERE relative_path NOT IN (${placeholders})`)
            .run(...paths);
    }

    listErrors() {
        return this.db.prepare(`
            SELECT relative_path AS relativePath, message
            FROM store_card_errors
            ORDER BY relative_path COLLATE NOCASE
        `).all();
    }
}

function ensureSchemaMigrations(db) {
    ensureColumns(db, 'store_card_tags', [
        { name: 'sort_order', sql: 'ALTER TABLE store_card_tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;' },
    ]);
    ensureColumns(db, 'store_cards', [
        { name: 'tag_mtime_ms', sql: 'ALTER TABLE store_cards ADD COLUMN tag_mtime_ms REAL NOT NULL DEFAULT 0;' },
        { name: 'tag_size', sql: 'ALTER TABLE store_cards ADD COLUMN tag_size INTEGER NOT NULL DEFAULT 0;' },
    ]);
}

function ensureColumns(db, tableName, migrations) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const columnNames = new Set(columns.map(column => column.name));
    for (const migration of migrations) {
        if (!columnNames.has(migration.name)) {
            db.exec(migration.sql);
        }
    }
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

function hydrateCard(card, tagsByCardId) {
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

function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
