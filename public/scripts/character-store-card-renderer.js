import {
    getStoreCardSummaryDisplay,
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
    appendCardSummary(meta, card);
    return meta;
}

function appendCardSummary(meta, card) {
    const summary = getStoreCardSummaryDisplay(card);
    if (summary) {
        meta.append($('<p></p>').text(summary));
    }
}

function getPreviewUrl(card, previewEndpoint) {
    return `${previewEndpoint}/${encodeURIComponent(card.id)}`;
}
