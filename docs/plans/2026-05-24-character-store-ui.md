# Character Store UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the character store filter surface, show one row of top-ranked tags in collapsed view, and refresh the storefront presentation.

**Architecture:** Keep the backend store index as-is and change the storefront UI layer only. Remove the unavailable category control from the modal, keep filtering through search plus tags, and make the tag rail deterministic by ranking tags by frequency and limiting the collapsed state to a single preview row. Update the modal header, controls, tag rail, and card styling together so the new behavior reads as one interface.

**Tech Stack:** JavaScript, HTML, CSS, Jest

---

### Task 1: Update behavior tests

**Files:**
- Modify: `tests/character-store-ui.test.js`

**Step 1: Write the failing test**

Add assertions that collapsed tag preview stays within the single-row preview capacity even when a hidden tag is selected, and that category does not affect `filterStoreCards`.

**Step 2: Run test to verify it fails**

Run: `node --input-type=module -e "import('./tests/character-store-ui.test.js')"`
Expected: fail against the current implementation.

**Step 3: Write minimal implementation**

Do not implement here.

**Step 4: Run test to verify it passes**

Run: same command after code changes.

### Task 2: Remove category control and simplify store filtering

**Files:**
- Modify: `public/scripts/character-store-data.js`
- Modify: `public/scripts/character-store.js`
- Modify: `public/index.html`

**Step 1: Write the failing test**

Use the updated unit tests from Task 1.

**Step 2: Run test to verify it fails**

Run the same verification command and confirm the old code no longer satisfies it.

**Step 3: Write minimal implementation**

Remove category state, event wiring, rendering, and category matching. Keep search and tag filters only.

**Step 4: Run test to verify it passes**

Run the same verification command.

### Task 3: Refresh storefront styling

**Files:**
- Modify: `public/style.css`

**Step 1: Write the failing test**

Use manual UI verification for the visual polish changes.

**Step 2: Run test to verify it fails**

Open the store modal before and after the CSS update and confirm the old layout still looks flat and crowded.

**Step 3: Write minimal implementation**

Rework the header, control strip, tag rail, and card treatment with denser hierarchy and cleaner spacing.

**Step 4: Run test to verify it passes**

Verify the modal renders cleanly in the browser and no text overflows.

### Task 4: Verify and stabilize

**Files:**
- Modify: none

**Step 1: Run targeted verification**

Check the store modal in the browser and run the UI helper assertions.

**Step 2: Commit**

Commit only after the behavior and presentation are confirmed.
