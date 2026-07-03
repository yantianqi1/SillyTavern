export const DEFAULT_CHARACTER_STORE_CATEGORY = '综合';
export const LEGACY_CHARACTER_STORE_CATEGORY = 'user-submissions';

export const CHARACTER_STORE_CATEGORIES = Object.freeze([
    { value: '综合', label: '综合' },
    { value: '现代都市', label: '现代都市' },
    { value: '古风仙侠', label: '古风仙侠' },
    { value: '玄幻奇幻', label: '玄幻奇幻' },
    { value: '科幻末世', label: '科幻末世' },
    { value: '校园青春', label: '校园青春' },
    { value: '恋爱情感', label: '恋爱情感' },
    { value: '悬疑推理', label: '悬疑推理' },
    { value: '历史架空', label: '历史架空' },
    { value: '同人二创', label: '同人二创' },
    { value: '剧情工具', label: '剧情工具' },
]);

export const CHARACTER_STORE_TAGS = Object.freeze([
    '原创',
    '女主',
    '男主',
    '群像',
    '甜宠',
    '虐恋',
    '强剧情',
    '轻松日常',
    '冒险',
    '战斗',
    '治愈',
    '暗黑',
    '成人向',
    '世界书完整',
    '长篇适配',
]);

const CATEGORY_VALUES = new Set(CHARACTER_STORE_CATEGORIES.map(category => category.value));
const TAG_VALUES = new Set(CHARACTER_STORE_TAGS);

export function normalizeStoreCategory(value) {
    const category = String(value || '').trim();
    if (!category || category === LEGACY_CHARACTER_STORE_CATEGORY) {
        return DEFAULT_CHARACTER_STORE_CATEGORY;
    }
    return CATEGORY_VALUES.has(category) ? category : DEFAULT_CHARACTER_STORE_CATEGORY;
}

export function parseStoreTags(value) {
    const rawTags = Array.isArray(value)
        ? value.flatMap(tag => parseStoreTags(tag))
        : String(value || '').split(/[\n,，、;；]+/);
    return uniqueStoreTags(rawTags);
}

export function uniqueStoreTags(tags) {
    const seen = new Set();
    const result = [];
    for (const tag of tags.map(tag => String(tag).trim()).filter(Boolean)) {
        if (!seen.has(tag)) {
            seen.add(tag);
            result.push(tag);
        }
    }
    return result;
}

export function getKnownStoreTags(tags) {
    return parseStoreTags(tags).filter(tag => TAG_VALUES.has(tag));
}

export function getCustomStoreTags(tags) {
    return parseStoreTags(tags).filter(tag => !TAG_VALUES.has(tag));
}
