import {
    getStoreCardSummaryDisplay,
    getStoreCardTagsDisplay,
} from './character-store-data.js';

export function renderStoreCard(card, previewEndpoint) {
    const item = $('<div></div>').addClass('character_store_card');
    const image = $('<img>').attr('src', getPreviewUrl(card, previewEndpoint)).attr('alt', card.name);
    item.append($('<div></div>').addClass('character_store_avatar').append(image));
    item.append(renderCardMeta(card));
    item.append(renderAddButton(card));
    return item;
}

export function renderStoreEmptyState(message) {
    return $('<div></div>')
        .addClass('character_store_empty')
        .text(message);
}

function renderAddButton(card) {
    return $('<button></button>')
        .addClass('menu_button menu_button_icon character_store_add')
        .attr('type', 'button')
        .data('card-id', card.id)
        .append($('<i></i>').addClass('fa-solid fa-plus'))
        .append($('<small></small>').text('添加'));
}

function renderCardMeta(card) {
    const meta = $('<div></div>').addClass('character_store_meta');
    meta.append($('<strong></strong>').text(card.name));
    if (card.category) {
        meta.append($('<span></span>').addClass('character_store_card_category').text(card.category));
    }
    appendCardTags(meta, card);
    appendCardSummary(meta, card);
    return meta;
}

function appendCardTags(meta, card) {
    const tags = getStoreCardTagsDisplay(card);
    if (tags.length) {
        meta.append(renderCardTags(tags));
    }
}

function appendCardSummary(meta, card) {
    const summary = getStoreCardSummaryDisplay(card);
    if (summary) {
        meta.append($('<p></p>').text(summary));
    }
}

function renderCardTags(tags) {
    const container = $('<div></div>').addClass('character_store_card_tags');
    for (const tag of tags) {
        container.append($('<span></span>').addClass('character_store_card_tag').text(tag));
    }
    return container;
}

function getPreviewUrl(card, previewEndpoint) {
    return `${previewEndpoint}/${encodeURIComponent(card.id)}`;
}
