import {
    CHARACTER_STORE_CATEGORIES,
    CHARACTER_STORE_TAGS,
    getCustomStoreTags,
    getKnownStoreTags,
    normalizeStoreCategory,
    parseStoreTags,
    uniqueStoreTags,
} from './character-store-taxonomy.js';

const LIST_ENDPOINT = '/api/characters/store/submissions/list';
const APPROVE_ENDPOINT = '/api/characters/store/submissions/approve';
const REJECT_ENDPOINT = '/api/characters/store/submissions/reject';
const IMPORT_ENDPOINT = '/api/characters/store/submissions/import';
const PREVIEW_ENDPOINT = '/api/characters/store/submissions/preview';
const UNLOCK_STATUS_ENDPOINT = '/api/characters/store/submissions/unlock-status';
const UNLOCK_ENDPOINT = '/api/characters/store/submissions/unlock';

let csrfToken = '';
let reviewKeyRequired = false;
let reviewUnlocked = true;
const elements = {};

document.addEventListener('DOMContentLoaded', () => {
    elements.list = document.getElementById('store_submission_list');
    elements.status = document.getElementById('store_submission_status');
    elements.refresh = document.getElementById('store_submission_refresh');
    elements.keyGate = document.getElementById('store_review_key_gate');
    elements.keyForm = document.getElementById('store_review_key_form');
    elements.keyInput = document.getElementById('store_review_key_input');
    elements.keySubmit = document.getElementById('store_review_key_submit');
    elements.keyMessage = document.getElementById('store_review_key_message');
    elements.refresh?.addEventListener('click', () => {
        void loadSubmissions();
    });
    elements.keyForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void unlockReviewKey();
    });
    void initializeAdminPage();
});

async function initializeAdminPage() {
    try {
        await loadCsrfToken();
        const unlockStatus = await checkUnlockStatus();
        setUnlockStatus(unlockStatus);
        if (isReviewLocked()) {
            showStatus('请输入审核密钥');
            focusReviewKeyInput();
            return;
        }
        await loadSubmissions();
    } catch (error) {
        showStatus(error.message || String(error), true);
    }
}

async function loadCsrfToken() {
    const response = await fetch('/csrf-token');
    const data = await response.json();
    csrfToken = data.token;
}

async function checkUnlockStatus() {
    const response = await fetch(UNLOCK_STATUS_ENDPOINT, {
        method: 'POST',
        headers: getRequestHeaders(),
    });
    return await readJsonResponse(response);
}

async function unlockReviewKey() {
    const key = elements.keyInput?.value?.trim() || '';
    if (!key) {
        showKeyMessage('请输入审核密钥', true);
        focusReviewKeyInput();
        return;
    }

    setUnlockBusy(true);
    showKeyMessage('正在验证密钥');
    try {
        const response = await fetch(UNLOCK_ENDPOINT, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key }),
        });
        const unlockStatus = await readJsonResponse(response);
        setUnlockStatus(unlockStatus);
        if (isReviewLocked()) {
            showKeyMessage('审核密钥未解锁', true);
            return;
        }

        if (elements.keyInput) {
            elements.keyInput.value = '';
        }
        showKeyMessage('');
        await loadSubmissions();
    } catch (error) {
        showKeyMessage(error.message || String(error), true);
        showStatus(error.message || String(error), true);
    } finally {
        setUnlockBusy(false);
    }
}

async function loadSubmissions() {
    if (isReviewLocked()) {
        showStatus('请输入审核密钥');
        focusReviewKeyInput();
        return;
    }

    setRefreshBusy(true);
    showStatus('正在载入待审核角色卡');
    try {
        const response = await fetch(LIST_ENDPOINT, {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        const data = await readJsonResponse(response);
        renderSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
    } catch (error) {
        showStatus(error.message || String(error), true);
    } finally {
        setRefreshBusy(false);
    }
}

function setUnlockStatus(status = {}) {
    reviewKeyRequired = Boolean(status.required);
    reviewUnlocked = Boolean(status.unlocked);
    setReviewKeyGateVisible(isReviewLocked());
}

function isReviewLocked() {
    return reviewKeyRequired && !reviewUnlocked;
}

function setReviewKeyGateVisible(isVisible) {
    if (elements.keyGate) {
        elements.keyGate.hidden = !isVisible;
    }
    if (elements.list) {
        elements.list.hidden = isVisible;
    }
    if (elements.refresh) {
        elements.refresh.disabled = isVisible;
        elements.refresh.classList.toggle('disabled', isVisible);
    }
}

function focusReviewKeyInput() {
    window.requestAnimationFrame(() => elements.keyInput?.focus());
}

function setUnlockBusy(isBusy) {
    if (elements.keySubmit) {
        elements.keySubmit.disabled = isBusy;
        elements.keySubmit.classList.toggle('disabled', isBusy);
    }
}

function showKeyMessage(message, isError = false) {
    if (!elements.keyMessage) {
        return;
    }
    elements.keyMessage.textContent = message;
    elements.keyMessage.classList.toggle('store_review_key_message_error', isError);
}

function renderSubmissions(submissions) {
    elements.list.replaceChildren();
    if (!submissions.length) {
        elements.list.append(renderEmptyState());
        showStatus('暂无待审核角色卡');
        return;
    }

    showStatus(`${submissions.length} 张角色卡等待审核`);
    for (const submission of submissions) {
        elements.list.append(renderSubmission(submission));
    }
}

function renderEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'store_submission_empty';
    empty.textContent = '暂无待审核角色卡';
    return empty;
}

function renderSubmission(submission) {
    const item = document.createElement('article');
    item.className = 'store_submission_item';
    item.dataset.submissionId = submission.id;

    const preview = document.createElement('img');
    preview.className = 'store_submission_preview';
    preview.src = `${PREVIEW_ENDPOINT}/${encodeURIComponent(submission.id)}`;
    preview.alt = submission.displayName || submission.cardName || 'Character card';
    item.append(preview);

    const form = document.createElement('div');
    form.className = 'store_submission_form';
    form.append(renderSubmissionHeader(submission));
    const fields = document.createElement('div');
    fields.className = 'store_submission_fields';
    fields.append(
        renderField('名称', 'name', submission.displayName || submission.cardName || ''),
        renderCategoryField('分类', 'category', submission.category),
        renderTagField('标签', 'tags', submission.tags),
        renderTextarea('简介', 'summary', submission.summary || ''),
    );
    form.append(fields);
    form.append(renderActions(submission));
    item.append(form);

    return item;
}

function renderSubmissionHeader(submission) {
    const header = document.createElement('header');
    header.className = 'store_submission_item_header';

    const title = document.createElement('h2');
    title.textContent = submission.displayName || submission.cardName || '未命名角色卡';
    header.append(title);

    const meta = document.createElement('p');
    const uploader = submission.submittedBy?.name || submission.submittedBy?.handle || 'Unknown';
    meta.textContent = `${uploader} · ${formatDate(submission.submittedAt)}`;
    header.append(meta);

    return header;
}

function renderField(labelText, fieldName, value, { compact = false } = {}) {
    const label = document.createElement('label');
    label.className = 'store_submission_field';
    label.classList.toggle('store_submission_field_compact', compact);
    label.append(renderLabelText(labelText));

    const input = document.createElement('input');
    input.className = 'text_pole';
    input.dataset.field = fieldName;
    input.value = value;
    label.append(input);
    return label;
}

function renderCategoryField(labelText, fieldName, value) {
    const label = document.createElement('label');
    label.className = 'store_submission_field';
    label.append(renderLabelText(labelText));

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.dataset.field = fieldName;
    for (const category of CHARACTER_STORE_CATEGORIES) {
        const option = document.createElement('option');
        option.value = category.value;
        option.textContent = category.label;
        select.append(option);
    }
    select.value = normalizeStoreCategory(value);
    label.append(select);
    return label;
}

function renderTagField(labelText, fieldName, tags) {
    const label = document.createElement('label');
    label.className = 'store_submission_field store_submission_field_wide store_submission_field_compact';
    label.append(renderLabelText(labelText));

    const input = document.createElement('input');
    input.className = 'text_pole';
    input.dataset.field = fieldName;
    input.placeholder = '补充标签，可用逗号分隔';
    input.value = getCustomStoreTags(tags).join(', ');
    label.append(input);

    const choices = document.createElement('div');
    choices.className = 'store_submission_tag_choices';
    const selectedTags = new Set(getKnownStoreTags(tags));
    for (const tag of CHARACTER_STORE_TAGS) {
        choices.append(renderTagChoice(tag, selectedTags.has(tag)));
    }
    label.append(choices);
    return label;
}

function renderTagChoice(tag, isSelected) {
    const button = document.createElement('button');
    button.className = 'store_submission_tag_choice';
    button.classList.toggle('store_submission_tag_choice_selected', isSelected);
    button.type = 'button';
    button.dataset.tag = tag;
    button.setAttribute('aria-pressed', String(isSelected));
    button.textContent = tag;
    button.addEventListener('click', () => {
        toggleTagChoice(button);
    });
    return button;
}

function toggleTagChoice(button) {
    const isSelected = !button.classList.contains('store_submission_tag_choice_selected');
    button.classList.toggle('store_submission_tag_choice_selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
}

function renderTextarea(labelText, fieldName, value) {
    const label = document.createElement('label');
    label.className = 'store_submission_field store_submission_field_wide';
    label.append(renderLabelText(labelText));

    const textarea = document.createElement('textarea');
    textarea.className = 'text_pole textarea_compact';
    textarea.dataset.field = fieldName;
    textarea.value = value;
    label.append(textarea);
    return label;
}

function renderLabelText(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
}

function renderActions(submission) {
    const actions = document.createElement('div');
    actions.className = 'store_submission_actions';

    const importButton = document.createElement('button');
    importButton.className = 'menu_button store_submission_import';
    importButton.type = 'button';
    importButton.title = '导入我的角色库后，可以在角色详情里检查世界书等完整信息';
    importButton.setAttribute('aria-label', '导入我的角色库');
    importButton.append(renderIcon('fa-file-import'), document.createTextNode('导入我的角色库'));
    importButton.addEventListener('click', () => {
        void importSubmissionToLibrary(submission.id);
    });

    const approve = document.createElement('button');
    approve.className = 'menu_button store_submission_approve';
    approve.type = 'button';
    approve.append(renderIcon('fa-circle-check'), document.createTextNode('通过'));
    approve.addEventListener('click', () => {
        void approveSubmission(submission.id);
    });

    const reject = document.createElement('button');
    reject.className = 'menu_button store_submission_reject';
    reject.type = 'button';
    reject.append(renderIcon('fa-ban'), document.createTextNode('拒绝'));
    reject.addEventListener('click', () => {
        void rejectSubmission(submission.id);
    });
    actions.append(importButton, approve, reject);

    return actions;
}

function renderIcon(iconClass) {
    const icon = document.createElement('i');
    icon.className = `fa-solid ${iconClass}`;
    return icon;
}

async function approveSubmission(submissionId) {
    const item = getSubmissionItem(submissionId);
    const payload = {
        id: submissionId,
        name: getSubmissionValue(item, 'name'),
        category: getSubmissionValue(item, 'category'),
        tags: getSubmissionTagsValue(item),
        summary: getSubmissionValue(item, 'summary'),
    };
    await postReviewAction(APPROVE_ENDPOINT, payload, '角色卡已加入公共仓库');
}

async function rejectSubmission(submissionId) {
    const reason = window.prompt('拒绝原因', '');
    if (reason === null) {
        return;
    }
    await postReviewAction(REJECT_ENDPOINT, { id: submissionId, reason }, '已拒绝该角色卡');
}

async function importSubmissionToLibrary(submissionId) {
    const item = getSubmissionItem(submissionId);
    const response = await postReviewAction(IMPORT_ENDPOINT, {
        id: submissionId,
        name: getSubmissionValue(item, 'name'),
    }, '已导入到你的角色库', { reload: false });
    if (response?.file_name) {
        showStatus(`已导入到你的角色库：${response.file_name}`);
    }
}

async function postReviewAction(endpoint, payload, successMessage, { reload = true } = {}) {
    showStatus('正在提交审核结果');
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(response);
    showStatus(successMessage);
    if (reload) {
        await loadSubmissions();
    }
    return data;
}

function getSubmissionItem(submissionId) {
    return [...elements.list.querySelectorAll('.store_submission_item')]
        .find(item => item.dataset.submissionId === submissionId);
}

function getSubmissionValue(item, fieldName) {
    return item?.querySelector(`[data-field="${fieldName}"]`)?.value || '';
}

function getSubmissionTagsValue(item) {
    const selectedTags = [...(item?.querySelectorAll('.store_submission_tag_choice_selected') || [])]
        .map(button => button.dataset.tag || '');
    const customTags = parseStoreTags(getSubmissionValue(item, 'tags'));
    return uniqueStoreTags([...selectedTags, ...customTags]).join('\n');
}

function formatDate(value) {
    if (!value) {
        return '';
    }
    return new Date(value).toLocaleString();
}

function getRequestHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
    };
}

async function readJsonResponse(response) {
    const data = await response.json();
    if (!response.ok || data?.error) {
        throw new Error(data?.message || response.statusText);
    }
    return data;
}

function setRefreshBusy(isBusy) {
    elements.refresh?.classList.toggle('disabled', isBusy);
    if (elements.refresh) {
        elements.refresh.disabled = isBusy;
    }
}

function showStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle('store_submission_status_error', isError);
}
