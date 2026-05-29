import {
    getStorePageWindow,
    prepareStoreCards,
    pruneStorePageCache,
    STORE_PAGE_SIZE,
} from './character-store-data.js';
import { renderStoreCard, renderStoreEmptyState } from './character-store-card-renderer.js';
import { renderStorePagination, renderStoreTags as renderTagControls } from './character-store-controls-renderer.js';
import { initFloatingCharacterStoreEntry } from './character-store-floating-entry.js';

export * from './character-store-data.js';

const STORE_LIST_ENDPOINT = '/api/characters/store/list';
const STORE_IMPORT_ENDPOINT = '/api/characters/store/import';
const STORE_PREVIEW_ENDPOINT = '/api/characters/store/preview';
const STORE_MODAL_OVERLAY_ID = 'character_store_modal_overlay';
const SEARCH_DEBOUNCE_MS = 180;

let dependencies = null;
let searchInputTimer = null;
let storeRequestId = 0;
const storeState = {
    pages: new Map(),
    pagination: { page: 1, pageSize: STORE_PAGE_SIZE, total: 0, totalPages: 1 },
    tagStats: [],
    selectedTags: new Set(),
    search: '',
    tagsExpanded: false,
};

export function initCharacterStore(deps) {
    dependencies = deps;
    initFloatingCharacterStoreEntry($('#character_store_sidebar_entry'));
    $('#rm_button_character_store, #character_store_sidebar_entry').on('click', openCharacterStore);
    $('#character_store_close').on('click', closeCharacterStore);
    $('#character_store_refresh').on('click', loadCharacterStore);
    $('#character_store_search').on('input', onSearchInput);
    $(`#${STORE_MODAL_OVERLAY_ID}`).on('click', onStoreOverlayClick);
    $(document).on('keydown', onStoreKeydown);
    $(document).on('click', '.character_store_tag', onTagClick);
    $(document).on('click', '.character_store_tags_toggle', onTagsToggleClick);
    $(document).on('click', '.character_store_add', onAddClick);
    $(document).on('click', '.character_store_page', onPageClick);
}

async function openCharacterStore(event) {
    event?.preventDefault();
    setCharacterStoreOpen(true);
    await loadCharacterStore();
    $('#character_store_search').trigger('focus');
}

function closeCharacterStore(event) {
    event?.preventDefault();
    setCharacterStoreOpen(false);
}

function onStoreOverlayClick(event) {
    if (event.target?.id === STORE_MODAL_OVERLAY_ID) {
        closeCharacterStore(event);
    }
}

function onStoreKeydown(event) {
    if (event.key === 'Escape' && isCharacterStoreOpen()) {
        closeCharacterStore(event);
    }
}

async function loadCharacterStore({ page = 1, refresh = true } = {}) {
    setStoreBusy(true);
    const requestId = storeRequestId += 1;
    const queryKey = getStoreQueryKey();
    try {
        const data = await requestStorePage(page, { refresh });
        if (requestId !== storeRequestId || queryKey !== getStoreQueryKey()) {
            return;
        }
        storeState.pages = new Map();
        applyStorePage(data);
        retainAvailableSelectedTags();
        renderStore();
        void preloadStorePageWindow(queryKey, requestId);
    } catch (error) {
        console.error('Failed to load character store.', error);
        toastr.error(error.message || String(error));
    } finally {
        setStoreBusy(false);
    }
}

async function requestStorePage(page, { refresh = false } = {}) {
    const response = await fetch(STORE_LIST_ENDPOINT, {
        method: 'POST',
        headers: dependencies.getRequestHeaders(),
        body: JSON.stringify({
            page,
            page_size: STORE_PAGE_SIZE,
            refresh,
            search: storeState.search,
            tags: [...storeState.selectedTags],
        }),
    });
    return await readJsonResponse(response);
}

function applyStorePage(data, { activate = true } = {}) {
    const pagination = data?.pagination || {};
    const page = Number(pagination.page) || 1;
    storeState.pagination = {
        page: activate ? page : storeState.pagination.page,
        pageSize: Number(pagination.pageSize) || STORE_PAGE_SIZE,
        total: Number(pagination.total) || 0,
        totalPages: Number(pagination.totalPages) || 1,
    };
    storeState.pages.set(page, prepareStoreCards(Array.isArray(data.cards) ? data.cards : []));
    storeState.tagStats = Array.isArray(data.tagStats) ? data.tagStats : [];
}

async function preloadStorePageWindow(queryKey, requestId = storeRequestId) {
    const pageWindow = getCurrentPageWindow();
    const missingPages = pageWindow.filter(page => !storeState.pages.has(page));
    trimStorePageCache(pageWindow);
    try {
        const pages = await Promise.all(missingPages.map(page => requestStorePage(page)));
        if (queryKey !== getStoreQueryKey() || requestId !== storeRequestId) {
            return;
        }
        pages.forEach(data => applyStorePage(data, { activate: false }));
        trimStorePageCache(pageWindow);
        renderPagination();
    } catch (error) {
        console.error('Failed to preload character store pages.', error);
    }
}

function getCurrentPageWindow() {
    return getStorePageWindow({
        page: storeState.pagination.page,
        totalPages: storeState.pagination.totalPages,
    });
}

function trimStorePageCache(pageWindow = getCurrentPageWindow()) {
    storeState.pages = pruneStorePageCache(storeState.pages, pageWindow);
}

function getStoreQueryKey() {
    return JSON.stringify({
        search: storeState.search,
        tags: [...storeState.selectedTags].sort(),
    });
}

async function readJsonResponse(response) {
    const data = await response.json();
    if (!response.ok || data?.error) {
        throw new Error(data?.message || response.statusText);
    }
    return data;
}

function retainAvailableSelectedTags() {
    const availableTags = new Set(storeState.tagStats.map(tagStat => tagStat.name));
    for (const tag of [...storeState.selectedTags]) {
        if (!availableTags.has(tag)) {
            storeState.selectedTags.delete(tag);
        }
    }
}

function onSearchInput() {
    storeState.search = String($('#character_store_search').val() || '');
    clearTimeout(searchInputTimer);
    searchInputTimer = setTimeout(() => {
        void loadCharacterStore({ page: 1, refresh: false });
    }, SEARCH_DEBOUNCE_MS);
}

function onTagClick() {
    const tag = String($(this).data('tag') || '');
    if (!tag) {
        return;
    }
    storeState.selectedTags.has(tag)
        ? storeState.selectedTags.delete(tag)
        : storeState.selectedTags.add(tag);
    renderStoreTags();
    void loadCharacterStore({ page: 1, refresh: false });
}

function onTagsToggleClick(event) {
    event?.preventDefault();
    storeState.tagsExpanded = !storeState.tagsExpanded;
    renderStoreTags();
}

async function onAddClick() {
    const button = $(this);
    const cardId = String(button.data('card-id') || '');
    if (!cardId || button.hasClass('disabled')) {
        return;
    }
    await importCard(cardId, button);
}

function onPageClick(event) {
    event?.preventDefault();
    const button = $(this);
    const page = Number(button.data('page'));
    if (!Number.isInteger(page) || button.hasClass('disabled')) {
        return;
    }
    if (storeState.pages.has(page)) {
        storeState.pagination = { ...storeState.pagination, page };
        trimStorePageCache();
        renderCards();
        renderPagination();
        void preloadStorePageWindow(getStoreQueryKey(), storeRequestId);
        return;
    }
    void loadCharacterStore({ page, refresh: false });
}

async function importCard(cardId, button) {
    button.addClass('disabled');
    try {
        const response = await fetch(STORE_IMPORT_ENDPOINT, {
            method: 'POST',
            headers: dependencies.getRequestHeaders(),
            body: JSON.stringify({ card_id: cardId }),
        });
        const data = await readJsonResponse(response);
        await dependencies.getCharacters();
        dependencies.select_rm_info('char_import', data.file_name);
    } catch (error) {
        console.error('Failed to import character store card.', error);
        toastr.error(error.message || String(error));
    } finally {
        button.removeClass('disabled');
    }
}

function renderStore() {
    renderStoreTags();
    renderCards();
    renderPagination();
}

function renderStoreTags() {
    renderTagControls($('#character_store_tags'), {
        tagStats: storeState.tagStats,
        tagsExpanded: storeState.tagsExpanded,
        selectedTags: storeState.selectedTags,
    });
}

function renderCards() {
    const cards = storeState.pages.get(storeState.pagination.page) || [];
    updateStoreCount(cards.length);
    const list = $('#character_store_list').empty();
    cards.length
        ? cards.forEach(card => list.append(renderStoreCard(card, STORE_PREVIEW_ENDPOINT)))
        : list.append(renderStoreEmptyState(getStoreEmptyMessage()));
}

function updateStoreCount(visibleCount) {
    const { page, total, totalPages } = storeState.pagination;
    $('#character_store_count').text(`${visibleCount}/${total} · ${page}/${totalPages}`);
}

function getStoreEmptyMessage() {
    return storeState.search || storeState.selectedTags.size
        ? '没有匹配的角色卡'
        : 'data/sheet 暂无角色卡';
}

function renderPagination() {
    const { page, totalPages } = storeState.pagination;
    renderStorePagination($('#character_store_pagination'), {
        page,
        totalPages,
        pageWindow: getCurrentPageWindow(),
    });
}

function setStoreBusy(isBusy) {
    $('#character_store_refresh').toggleClass('disabled', isBusy);
    $('#character_store_loading').toggle(isBusy);
}

function setCharacterStoreOpen(isOpen) {
    const overlay = $(`#${STORE_MODAL_OVERLAY_ID}`);
    overlay.css('display', isOpen ? 'flex' : 'none').attr('aria-hidden', String(!isOpen));
    $('body').toggleClass('character_store_modal_open', isOpen);
}

function isCharacterStoreOpen() {
    return $(`#${STORE_MODAL_OVERLAY_ID}`).is(':visible');
}
