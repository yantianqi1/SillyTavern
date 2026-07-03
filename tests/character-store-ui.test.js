import fs from 'node:fs';

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
const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const characterStoreScript = fs.readFileSync(new URL('../public/scripts/character-store.js', import.meta.url), 'utf8');
const characterStoreCardRendererScript = fs.readFileSync(new URL('../public/scripts/character-store-card-renderer.js', import.meta.url), 'utf8');
const characterStoreTaxonomyScript = readProjectFile('public/scripts/character-store-taxonomy.js');
const characterStoreCss = fs.readFileSync(new URL('../public/css/character-store.css', import.meta.url), 'utf8');
const characterStoreCardsCss = fs.readFileSync(new URL('../public/css/character-store-cards.css', import.meta.url), 'utf8');
const serverMainScript = fs.readFileSync(new URL('../src/server-main.js', import.meta.url), 'utf8');

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

function readProjectFile(relativePath) {
    try {
        return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return '';
        }
        throw error;
    }
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

describe('character store entry points', () => {
    test('uses the character list toolbar entry without rendering the floating entry', () => {
        expect(indexHtml).toContain('id="rm_button_character_store"');
        expect(indexHtml).not.toContain('id="character_store_sidebar_entry"');
        expect(indexHtml).not.toContain('character-store-floating-entry.css');
        expect(characterStoreScript).not.toContain('character-store-floating-entry.js');
        expect(characterStoreScript).not.toContain('#character_store_sidebar_entry');
    });

    test('labels the Fluent store command buttons accessibly', () => {
        expect(indexHtml).toContain('<small>公共角色库</small>');
        expect(indexHtml).toContain('id="character_store_upload"');
        expect(indexHtml).toContain('aria-label="上传角色卡"');
        expect(indexHtml).toContain('aria-label="刷新角色卡商店"');
        expect(indexHtml).toContain('aria-label="关闭角色卡商店"');
    });
});

describe('character store card layout', () => {
    test('does not render per-card tag chips inside the card grid', () => {
        expect(characterStoreCardRendererScript).not.toContain('character_store_card_tags');
        expect(characterStoreCardRendererScript).not.toContain('character_store_card_tag');
        expect(characterStoreCardsCss).not.toContain('character_store_card_tags');
        expect(characterStoreCardsCss).not.toContain('character_store_card_tag');
    });
});

describe('character store upload UI', () => {
    test('exposes a submission upload panel from the store modal', () => {
        expect(indexHtml).toContain('id="character_store_upload"');
        expect(indexHtml).toContain('id="character_store_upload_panel"');
        expect(indexHtml).toContain('id="character_store_upload_file"');
        expect(indexHtml).toContain('id="character_store_upload_category"');
    });

    test('uses friendly selectable categories and common tags for uploads', () => {
        expect(indexHtml).toContain('<select id="character_store_upload_category"');
        expect(indexHtml).toContain('id="character_store_upload_tag_choices"');
        expect(indexHtml).toContain('placeholder="补充标签，可用逗号分隔"');
        expect(characterStoreTaxonomyScript).toContain('CHARACTER_STORE_CATEGORIES');
        expect(characterStoreTaxonomyScript).toContain('现代都市');
        expect(characterStoreTaxonomyScript).toContain('古风仙侠');
        expect(characterStoreTaxonomyScript).toContain('CHARACTER_STORE_TAGS');
        expect(characterStoreTaxonomyScript).toContain('世界书完整');
        expect(characterStoreScript).toContain('renderStoreUploadTaxonomyControls');
        expect(characterStoreScript).toContain('getSelectedStoreUploadTags');
    });

    test('exposes an originality confirmation dialog before upload', () => {
        expect(indexHtml).toContain('id="character_store_original_confirm_overlay"');
        expect(indexHtml).toContain('id="character_store_original_confirm_checkbox"');
        expect(indexHtml).toContain('id="character_store_original_confirm_submit"');
        expect(indexHtml).toContain('id="character_store_original_confirm_cancel"');
        expect(indexHtml).toContain('我确认这张角色卡是我原创');
    });

    test('posts multipart submissions to the store upload endpoint', () => {
        expect(characterStoreScript).toContain('\'/api/characters/store/submissions/upload\'');
        expect(characterStoreScript).toContain('await confirmStoreOriginalUpload()');
        expect(characterStoreScript).toContain('new FormData');
        expect(characterStoreScript).toContain('formData.append(\'original_confirmed\', \'true\')');
        expect(characterStoreScript).toContain('getRequestHeaders({ omitContentType: true })');
    });

    test('styles the upload panel inside the store modal', () => {
        expect(characterStoreCss).toContain('.character_store_upload_panel');
        expect(characterStoreCss).toContain('.character_store_tag_choices');
        expect(characterStoreCss).toContain('.character_store_tag_choice_selected');
    });

    test('keeps the upload panel compact when opened', () => {
        expect(characterStoreCss).toMatch(/\.character_store_upload_panel\s*\{[\s\S]*max-height:\s*min\(34vh,\s*260px\);[\s\S]*overflow-y:\s*auto;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/\.character_store_upload_actions \.menu_button\s*\{[\s\S]*min-width:\s*132px;[\s\S]*white-space:\s*nowrap;[\s\S]*\}/);
    });

    test('keeps the file picker visible inside the Fluent upload panel', () => {
        expect(characterStoreCss).toContain('.character_store_upload_panel input[type="file"]');
        expect(characterStoreCss).toMatch(/\.character_store_upload_panel input\[type="file"\]\s*\{[\s\S]*display:\s*block;[\s\S]*\}/);
        expect(characterStoreCss).toContain('.character_store_upload_panel input[type="file"]::file-selector-button');
    });

    test('styles the originality confirmation dialog as a focused modal', () => {
        expect(characterStoreCss).toContain('.character_store_original_confirm_overlay');
        expect(characterStoreCss).toContain('.character_store_original_confirm_dialog');
        expect(characterStoreCss).toContain('.character_store_original_confirm_check');
    });
});

describe('character store modal layout', () => {
    test('prioritizes the card grid over chrome and pagination', () => {
        expect(characterStoreCss).toMatch(/\.character_store_modal\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/\.character_store_list\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/\.character_store_pagination\s*\{[\s\S]*position:\s*static;[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/\.character_store_pagination \.menu_button\s*\{[\s\S]*white-space:\s*nowrap;[\s\S]*width:\s*auto;[\s\S]*\}/);
    });

    test('uses a Fluent 2 acrylic visual system for the store shell', () => {
        expect(characterStoreCss).toMatch(/\.character_store_modal\s*\{[\s\S]*--character-store-accent:\s*#0078d4;[\s\S]*--character-store-surface:\s*rgba\(255,\s*255,\s*255,\s*0\.78\);[\s\S]*backdrop-filter:\s*blur\(28px\) saturate\(1\.25\);[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/\.character_store_showcase\s*\{[\s\S]*background:\s*var\(--character-store-surface-strong\);[\s\S]*backdrop-filter:\s*blur\(18px\) saturate\(1\.15\);[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/\.character_store_controls\s*\{[\s\S]*background:\s*var\(--character-store-surface\);[\s\S]*backdrop-filter:\s*blur\(16px\) saturate\(1\.12\);[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/\.character_store_upload_panel\s*\{[\s\S]*background:\s*var\(--character-store-surface-strong\);[\s\S]*backdrop-filter:\s*blur\(18px\) saturate\(1\.15\);[\s\S]*\}/);
    });

    test('keeps the Fluent 2 card gallery readable and space-stable', () => {
        expect(characterStoreCardsCss).toMatch(/\.character_store_list\s*\{[\s\S]*grid-auto-rows:\s*clamp\(214px,\s*calc\(\(100% - 12px\) \/ 2\),\s*336px\);[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(168px,\s*1fr\)\);[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/\.character_store_list\s*\{[\s\S]*padding:\s*4px 3px 0;[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/\.character_store_card\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.74\);[\s\S]*backdrop-filter:\s*blur\(18px\) saturate\(1\.16\);[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/\.character_store_meta\s*\{[\s\S]*background:\s*linear-gradient\(180deg,\s*rgba\(255,\s*255,\s*255,\s*0\.94\),\s*rgba\(248,\s*251,\s*255,\s*0\.9\)\);[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/\.character_store_add\s*\{[\s\S]*background:\s*var\(--character-store-accent\);[\s\S]*min-height:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*\}/);
    });
});

describe('character store submission admin page', () => {
    test('serves an admin review page shell', () => {
        const adminHtml = readProjectFile('public/character-store-admin.html');

        expect(adminHtml).toContain('type="module" src="scripts/character-store-admin.js"');
        expect(adminHtml).toContain('id="store_submission_list"');
        expect(adminHtml).toContain('id="store_review_key_gate"');
        expect(adminHtml).toContain('id="store_review_key_input"');
        expect(adminHtml).toContain('id="store_review_key_submit"');
        expect(adminHtml).toContain('css/character-store-admin.css');
    });

    test('calls the submission review endpoints from the admin script', () => {
        const adminScript = readProjectFile('public/scripts/character-store-admin.js');

        expect(adminScript).toContain('\'/api/characters/store/submissions/list\'');
        expect(adminScript).toContain('\'/api/characters/store/submissions/approve\'');
        expect(adminScript).toContain('\'/api/characters/store/submissions/reject\'');
        expect(adminScript).toContain('\'/api/characters/store/submissions/import\'');
        expect(adminScript).toContain('\'/api/characters/store/submissions/unlock-status\'');
        expect(adminScript).toContain('\'/api/characters/store/submissions/unlock\'');
    });

    test('lets admins import a pending submission before deciding', () => {
        const adminScript = readProjectFile('public/scripts/character-store-admin.js');

        expect(adminScript).toContain('store_submission_import');
        expect(adminScript).toContain('导入我的角色库');
        expect(adminScript).toContain('importSubmissionToLibrary');
        expect(adminScript).toMatch(/actions\.append\(importButton,\s*approve,\s*reject\);/);
    });

    test('uses a compact review queue layout for many submissions', () => {
        const adminCss = readProjectFile('public/css/character-store-admin.css');

        expect(adminCss).toContain('.store_submission_fields');
        expect(adminCss).toContain('.store_submission_field_compact');
        expect(adminCss).toContain('.store_submission_import');
        expect(adminCss).toContain('.store_submission_tag_choices');
        expect(adminCss).toMatch(/\.store_submission_item\s*\{[\s\S]*grid-template-columns:\s*82px minmax\(0,\s*1fr\);[\s\S]*\}/);
        expect(adminCss).toMatch(/\.store_submission_actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto;[\s\S]*\}/);
    });

    test('lets admins adjust category and tags with controlled choices', () => {
        const adminScript = readProjectFile('public/scripts/character-store-admin.js');

        expect(adminScript).toContain('CHARACTER_STORE_CATEGORIES');
        expect(adminScript).toContain('CHARACTER_STORE_TAGS');
        expect(adminScript).toContain('renderCategoryField');
        expect(adminScript).toContain('renderTagField');
        expect(adminScript).toContain('getSubmissionTagsValue');
        expect(adminScript).toContain('toggleTagChoice');
    });

    test('keeps admin toolbar buttons horizontal instead of stacked by global menu button width', () => {
        const adminCss = readProjectFile('public/css/character-store-admin.css');

        expect(adminCss).toMatch(/\.store_submission_toolbar_actions \.menu_button\s*\{[^}]*white-space:\s*nowrap;[^}]*width:\s*auto;[^}]*\}/);
        expect(adminCss).toMatch(/\.store_review_key_form \.menu_button\s*\{[^}]*white-space:\s*nowrap;[^}]*width:\s*auto;[^}]*\}/);
    });

    test('checks review key unlock status before loading submissions', () => {
        const adminScript = readProjectFile('public/scripts/character-store-admin.js');

        expect(adminScript).toMatch(/await loadCsrfToken\(\);\s*const unlockStatus = await checkUnlockStatus\(\);[\s\S]*await loadSubmissions\(\);/);
    });

    test('has page styles and a protected server route', () => {
        const adminCss = readProjectFile('public/css/character-store-admin.css');

        expect(adminCss).toContain('.store_submission_list');
        expect(serverMainScript).toContain('\'/character-store-admin\'');
    });
});

describe('character store mobile layout', () => {
    test('keeps the modal overlay anchored to the viewport', () => {
        expect(characterStoreCss).toMatch(/\.character_store_modal_overlay\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/\.character_store_modal_overlay\s*\{[\s\S]*height:\s*100vh;[\s\S]*height:\s*100dvh;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/\.character_store_modal_overlay\s*\{[\s\S]*width:\s*100vw;[\s\S]*\}/);
        expect(characterStoreScript).toMatch(/ensureCharacterStoreOverlayRoot\(\);/);
        expect(characterStoreScript).toMatch(/overlay\.appendTo\(document\.body\);/);
    });

    test('keeps the modal close control reachable on phone-sized viewports', () => {
        expect(characterStoreCss).toMatch(/@media screen and \(max-width: 600px\)[\s\S]*\.character_store_modal_overlay\s*\{[\s\S]*align-items:\s*stretch;[\s\S]*padding:\s*0;[\s\S]*\}/);
        expect(characterStoreCardsCss).toMatch(/@media screen and \(max-width: 600px\)[\s\S]*\.character_store_modal\s*\{[\s\S]*height:\s*100dvh;[\s\S]*max-height:\s*100dvh;[\s\S]*width:\s*100vw;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/@media screen and \(max-width: 600px\)[\s\S]*\.character_store_showcase\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/@media screen and \(max-width: 600px\)[\s\S]*\.character_store_showcase_actions\s*\{[\s\S]*grid-column:\s*auto;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/#character_store_close,[\s\S]*#character_store_refresh,[\s\S]*#character_store_upload\s*\{[\s\S]*min-height:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*\}/);
        expect(characterStoreCss).toMatch(/@media screen and \(max-width: 600px\)[\s\S]*#rm_button_character_store\s*\{[\s\S]*min-height:\s*44px;[\s\S]*min-width:\s*44px;[\s\S]*\}/);
    });
});
