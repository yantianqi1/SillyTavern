export const FLOATING_ENTRY_EDGE_GAP = 8;
export const FLOATING_ENTRY_DRAG_THRESHOLD_PX = 6;
export const FLOATING_ENTRY_POSITION_KEY = 'SillyTavern.characterStore.floatingEntryPosition';

const FLOATING_ENTRY_EVENT_NAMESPACE = '.characterStoreFloatingEntry';
const FLOATING_ENTRY_POSITIONED_CLASS = 'character_store_sidebar_entry_positioned';
const FLOATING_ENTRY_DRAGGING_CLASS = 'character_store_sidebar_entry_dragging';
const PRIMARY_POINTER_BUTTON = 0;

export function initFloatingCharacterStoreEntry(entry, options = {}) {
    const element = getEntryElement(entry);
    const environment = getFloatingEntryEnvironment(options);
    const controller = createFloatingEntryController(element, environment);
    restoreFloatingEntryPosition(element, environment);
    entry.off(FLOATING_ENTRY_EVENT_NAMESPACE)
        .on(`pointerdown${FLOATING_ENTRY_EVENT_NAMESPACE}`, controller.onPointerDown)
        .on(`click${FLOATING_ENTRY_EVENT_NAMESPACE}`, controller.onClick);
    $(environment.windowRef)
        .off(`resize${FLOATING_ENTRY_EVENT_NAMESPACE}`)
        .on(`resize${FLOATING_ENTRY_EVENT_NAMESPACE}`, controller.onResize);
}

export function clampFloatingEntryPosition(position, { entry, viewport, edgeGap = FLOATING_ENTRY_EDGE_GAP } = {}) {
    assertPoint(position, 'position');
    assertSize(entry, 'entry');
    assertSize(viewport, 'viewport');
    const minX = edgeGap;
    const minY = edgeGap;
    const maxX = Math.max(minX, viewport.width - entry.width - edgeGap);
    const maxY = Math.max(minY, viewport.height - entry.height - edgeGap);
    return {
        x: clampNumber(position.x, minX, maxX),
        y: clampNumber(position.y, minY, maxY),
    };
}

export function hasFloatingEntryDragMoved(start, current, threshold = FLOATING_ENTRY_DRAG_THRESHOLD_PX) {
    assertPoint(start, 'start');
    assertPoint(current, 'current');
    const deltaX = current.x - start.x;
    const deltaY = current.y - start.y;
    return deltaX * deltaX + deltaY * deltaY >= threshold * threshold;
}

function createFloatingEntryController(element, environment) {
    let dragState = null;
    let suppressNextClick = false;
    const onPointerMove = event => {
        dragState = moveFloatingEntry(event, { element, dragState, environment });
    };
    const finishDrag = () => {
        if (dragState?.moved && dragState.position) {
            suppressNextClick = true;
            saveFloatingEntryPosition(environment.storage, dragState.position);
        }
        dragState = null;
        element.classList.remove(FLOATING_ENTRY_DRAGGING_CLASS);
        environment.documentRef.removeEventListener('pointermove', onPointerMove);
        environment.documentRef.removeEventListener('pointerup', finishDrag);
        environment.documentRef.removeEventListener('pointercancel', finishDrag);
    };
    return {
        onPointerDown(event) {
            dragState = startFloatingEntryDrag(getNativeEvent(event), {
                element,
                environment,
                finishDrag,
                onPointerMove,
            });
        },
        onClick(event) {
            if (!suppressNextClick) {
                return;
            }
            suppressNextClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        },
        onResize() {
            resizeFloatingEntryPosition(element, environment);
        },
    };
}

function startFloatingEntryDrag(event, { element, environment, onPointerMove, finishDrag }) {
    if (!isPrimaryPointer(event)) {
        return null;
    }
    const rect = element.getBoundingClientRect();
    const dragState = {
        moved: false,
        pointer: getPointerPosition(event),
        position: { x: rect.left, y: rect.top },
    };
    element.classList.add(FLOATING_ENTRY_DRAGGING_CLASS);
    environment.documentRef.addEventListener('pointermove', onPointerMove);
    environment.documentRef.addEventListener('pointerup', finishDrag);
    environment.documentRef.addEventListener('pointercancel', finishDrag);
    return dragState;
}

function moveFloatingEntry(event, { element, dragState, environment }) {
    if (!dragState) {
        return null;
    }
    const pointer = getPointerPosition(event);
    const moved = dragState.moved || hasFloatingEntryDragMoved(dragState.pointer, pointer);
    if (!moved) {
        return dragState;
    }
    event.preventDefault();
    const requestedPosition = {
        x: dragState.position.x + pointer.x - dragState.pointer.x,
        y: dragState.position.y + pointer.y - dragState.pointer.y,
    };
    return {
        ...dragState,
        moved: true,
        position: applyFloatingEntryPosition(element, requestedPosition, environment.windowRef),
    };
}

function resizeFloatingEntryPosition(element, environment) {
    if (!element.classList.contains(FLOATING_ENTRY_POSITIONED_CLASS)) {
        return;
    }
    const rect = element.getBoundingClientRect();
    const position = applyFloatingEntryPosition(element, { x: rect.left, y: rect.top }, environment.windowRef);
    saveFloatingEntryPosition(environment.storage, position);
}

function restoreFloatingEntryPosition(element, environment) {
    const position = readFloatingEntryPosition(environment.storage);
    if (!position) {
        return;
    }
    applyFloatingEntryPosition(element, position, environment.windowRef);
}

function applyFloatingEntryPosition(element, position, windowRef) {
    const rect = element.getBoundingClientRect();
    const nextPosition = clampFloatingEntryPosition(position, {
        entry: { width: rect.width, height: rect.height },
        viewport: { width: windowRef.innerWidth, height: windowRef.innerHeight },
    });
    element.classList.add(FLOATING_ENTRY_POSITIONED_CLASS);
    element.style.left = `${nextPosition.x}px`;
    element.style.top = `${nextPosition.y}px`;
    element.style.right = 'auto';
    element.style.transform = 'none';
    return nextPosition;
}

function readFloatingEntryPosition(storage) {
    const rawPosition = storage.getItem(FLOATING_ENTRY_POSITION_KEY);
    if (!rawPosition) {
        return null;
    }
    const position = JSON.parse(rawPosition);
    assertPoint(position, 'stored floating entry position');
    return position;
}

function saveFloatingEntryPosition(storage, position) {
    storage.setItem(FLOATING_ENTRY_POSITION_KEY, JSON.stringify(position));
}

function getFloatingEntryEnvironment(options) {
    const windowRef = options.windowRef || window;
    return {
        documentRef: options.documentRef || document,
        storage: options.storage || windowRef.localStorage,
        windowRef,
    };
}

function getEntryElement(entry) {
    const element = entry?.[0] || entry;
    if (!element) {
        throw new Error('Missing character store floating entry element.');
    }
    return element;
}

function isPrimaryPointer(event) {
    return event && (event.button === undefined || event.button === PRIMARY_POINTER_BUTTON);
}

function getNativeEvent(event) {
    return event?.originalEvent || event;
}

function getPointerPosition(event) {
    return { x: event.clientX, y: event.clientY };
}

function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function assertPoint(point, label) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new TypeError(`Invalid ${label}.`);
    }
}

function assertSize(size, label) {
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
        throw new TypeError(`Invalid ${label} size.`);
    }
}
