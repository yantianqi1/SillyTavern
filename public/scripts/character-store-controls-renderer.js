import {
    getHiddenStoreTagCount,
    getVisibleStoreTagStats,
} from './character-store-data.js';

export function renderStoreTags(container, { tagStats, tagsExpanded, selectedTags }) {
    container.empty().toggleClass('expanded', tagsExpanded);
    if (!tagStats.length) {
        return;
    }
    const visibleTagStats = getVisibleStoreTagStats({ tagStats, expanded: tagsExpanded });
    container.append(renderTagList(visibleTagStats, selectedTags));
    const hiddenCount = getHiddenStoreTagCount(tagStats, visibleTagStats);
    if (hiddenCount > 0 || tagsExpanded) {
        container.append(renderTagToggle({ hiddenCount, expanded: tagsExpanded }));
    }
}

export function renderStorePagination(container, { page, totalPages, pageWindow }) {
    container.empty();
    container.append(renderPageButton({ label: '上一页', page: page - 1, disabled: page <= 1 }));
    for (const pageNumber of pageWindow) {
        container.append(renderPageButton({
            label: String(pageNumber),
            page: pageNumber,
            active: pageNumber === page,
        }));
    }
    container.append(renderPageButton({ label: '下一页', page: page + 1, disabled: page >= totalPages }));
}

function renderTagList(tagStats, selectedTags) {
    const list = $('<div></div>').addClass('character_store_tag_list');
    for (const tagStat of tagStats) {
        list.append(renderTagButton(tagStat, selectedTags));
    }
    return list;
}

function renderTagButton(tagStat, selectedTags) {
    const active = selectedTags.has(tagStat.name);
    return $('<button></button>')
        .addClass(`character_store_tag ${active ? 'active' : ''}`)
        .attr('type', 'button')
        .attr('title', `${tagStat.name} (${tagStat.count})`)
        .data('tag', tagStat.name)
        .append($('<span></span>').addClass('character_store_tag_name').text(tagStat.name))
        .append($('<span></span>').addClass('character_store_tag_count').text(tagStat.count));
}

function renderTagToggle({ hiddenCount, expanded }) {
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

function renderPageButton({ label, page, disabled = false, active = false }) {
    return $('<button></button>')
        .addClass(`menu_button character_store_page ${active ? 'active' : ''}`)
        .toggleClass('disabled', disabled)
        .attr('type', 'button')
        .attr('aria-current', active ? 'page' : null)
        .data('page', page)
        .text(label);
}
