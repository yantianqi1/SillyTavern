import {
    filterStoreCards,
    getHiddenStoreTagCount,
    getStoreCardSummaryDisplay,
    getStoreCardTagsDisplay,
    getStoreTagStats,
    getVisibleStoreTagStats,
    prepareStoreCards,
} from './character-store-data.js';

export * from './character-store-data.js';

const STORE_LIST_ENDPOINT = '/api/characters/store/list';
const STORE_IMPORT_ENDPOINT = '/api/characters/store/import';
const STORE_PREVIEW_ENDPOINT = '/api/characters/store/preview';
const STORE_MODAL_OVERLAY_ID = 'character_store_modal_overlay';

let dependencies = null;
const storeState = {
    cards: [],
    tagStats: [],
    selectedTags: new Set(),
    search: '',
    tagsExpanded: false,
};

export function initCharacterStore(deps) {
    dependencies = deps;
    $('#rm_button_character_store, #character_store_sidebar_entry').on('click', openCharacterStore);
    $('#character_store_close').on('click', closeCharacterStore);
    $('#character_store_refresh').on('click', loadCharacterStore);
    $('#character_store_search').on('input', onSearchInput);
    $(`#${STORE_MODAL_OVERLAY_ID}`).on('click', onStoreOverlayClick);
    $(document).on('keydown', onStoreKeydown);
    $(document).on('click', '.character_store_tag', onTagClick);
    $(document).on('click', '.character_store_tags_toggle', onTagsToggleClick);
    $(document).on('click', '.character_store_add', onAddClick);
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

async function loadCharacterStore() {
    setStoreBusy(true);
    try {
        const response = await fetch(STORE_LIST_ENDPOINT, {
            method: 'POST',
            headers: dependencies.getRequestHeaders(),
        });
        const data = await readJsonResponse(response);
        storeState.cards = Array.isArray(data.cards) ? prepareStoreCards(data.cards) : [];
        storeState.tagStats = getStoreTagStats(storeState.cards);
        retainAvailableSelectedTags();
        renderStore();
    } catch (error) {
        console.error('Failed to load character store.', error);
        toastr.error(error.message || String(error));
    } finally {
        setStoreBusy(false);
    }
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
    renderCards();
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
    renderCards();
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
}

function renderStoreTags() {
    const container = $('#character_store_tags').empty();
    container.toggleClass('expanded', storeState.tagsExpanded);
    if (!storeState.tagStats.length) {
        return;
    }

    const visibleTagStats = getVisibleStoreTagStats({
        tagStats: storeState.tagStats,
        expanded: storeState.tagsExpanded,
    });
    container.append(renderTagList(visibleTagStats));

    const hiddenCount = getHiddenStoreTagCount(storeState.tagStats, visibleTagStats);
    if (hiddenCount > 0 || storeState.tagsExpanded) {
        container.append(renderTagToggle(hiddenCount));
    }
}

function renderTagList(tagStats) {
    const list = $('<div></div>').addClass('character_store_tag_list');
    for (const tagStat of tagStats) {
        list.append(renderTagButton(tagStat));
    }
    return list;
}

function renderTagButton(tagStat) {
    const active = storeState.selectedTags.has(tagStat.name);
    return $('<button></button>')
        .addClass(`character_store_tag ${active ? 'active' : ''}`)
        .attr('type', 'button')
        .attr('title', `${tagStat.name} (${tagStat.count})`)
        .data('tag', tagStat.name)
        .append($('<span></span>').addClass('character_store_tag_name').text(tagStat.name))
        .append($('<span></span>').addClass('character_store_tag_count').text(tagStat.count));
}

function renderTagToggle(hiddenCount) {
    const expanded = storeState.tagsExpanded;
    const label = expanded ? '收起标签' : `展开 ${hiddenCount}`;
    return $('<button></button>')
        .addClass(`character_store_tags_toggle ${expanded ? 'expanded' : ''}`)
        .attr('type', 'button')
        .attr('title', expanded ? '收起标签' : `展开全部标签，可选 ${hiddenCount} 个`)
        .attr('aria-label', expanded ? '收起标签列表' : `展开全部标签，剩余 ${hiddenCount} 个`)
        .attr('aria-expanded', String(expanded))
        .append($('<i></i>').addClass(`fa-solid ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}`))
        .append($('<span></span>').addClass('character_store_tags_toggle_label').text(label));
}

function renderCards() {
    const cards = filterStoreCards(storeState.cards, {
        search: storeState.search,
        tags: [...storeState.selectedTags],
    });
    $('#character_store_count').text(`${cards.length}/${storeState.cards.length}`);
    const list = $('#character_store_list').empty();
    cards.length ? cards.forEach(card => list.append(renderCard(card))) : renderEmptyState(list);
}

function renderCard(card) {
    const item = $('<div></div>').addClass('character_store_card');
    const image = $('<img>').attr('src', getPreviewUrl(card)).attr('alt', card.name);
    item.append($('<div></div>').addClass('character_store_avatar').append(image));
    item.append(renderCardMeta(card));
    item.append($('<button></button>')
        .addClass('menu_button menu_button_icon character_store_add')
        .attr('type', 'button')
        .data('card-id', card.id)
        .append($('<i></i>').addClass('fa-solid fa-plus'))
        .append($('<small></small>').text('添加')));
    return item;
}

function renderCardMeta(card) {
    const meta = $('<div></div>').addClass('character_store_meta');
    meta.append($('<strong></strong>').text(card.name));
    if (card.category) {
        meta.append($('<span></span>').addClass('character_store_card_category').text(card.category));
    }
    const tags = getStoreCardTagsDisplay(card);
    if (tags.length) {
        meta.append(renderCardTags(tags));
    }
    const summary = getStoreCardSummaryDisplay(card);
    if (summary) {
        meta.append($('<p></p>').text(summary));
    }
    return meta;
}

function renderCardTags(tags) {
    const container = $('<div></div>').addClass('character_store_card_tags');
    for (const tag of tags) {
        container.append($('<span></span>')
            .addClass('character_store_card_tag')
            .text(tag));
    }
    return container;
}

function renderEmptyState(list) {
    list.append($('<div></div>')
        .addClass('character_store_empty')
        .text('data/sheet 暂无角色卡'));
}

function getPreviewUrl(card) {
    return `${STORE_PREVIEW_ENDPOINT}/${encodeURIComponent(card.id)}`;
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
