# Public User Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fully open self-service registration to the public SillyTavern login page.

**Architecture:** Add a dedicated public registration endpoint instead of weakening the admin user creation endpoint. Keep registration behind a new config flag, create regular enabled users only, and reuse the existing password hashing and user directory initialization paths. The login page gets a small register mode that submits to the new endpoint and redirects on success.

**Tech Stack:** Express, node-persist, existing SillyTavern user helpers, jQuery login script, Jest unit tests.

---

## File Structure

- Modify `src/endpoints/users-public.js`: add public registration route, slug normalization, rate limit, and user creation.
- Modify `public/login.html`: add registration prompt, entry button, and form fields.
- Modify `public/scripts/login.js`: add register view switching, validation, submit, and auto-login redirect.
- Modify `public/css/login.css`: style the new register controls consistently with the existing light login theme.
- Modify `default/config.yaml`, `config.yaml`, and `docker/config/config.yaml`: add `enablePublicUserRegistration`; active configs set it to `true`.
- Create `tests/public-registration.test.js`: backend behavior tests for public registration.
- Modify `tests/login-welcome.test.js`: static login page/script coverage for the registration UI.

### Task 1: Backend Public Registration Tests

**Files:**
- Create: `tests/public-registration.test.js`

- [ ] **Step 1: Write failing backend tests**

Create `tests/public-registration.test.js` with tests that start an Express app using `usersPublic.router`, enable registration through environment variables, and verify:

```js
test('registers a regular enabled user and logs them in', async () => {
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'alice', name: 'Alice', password: 'pass-alice' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handle: 'alice' });
    expect(lastSession.handle).toBe('alice');

    const user = await storage.getItem('user:alice');
    expect(user.enabled).toBe(true);
    expect(user.admin).toBe(false);
    expect(user.password).toBeTruthy();
    expect(user.password).not.toBe('pass-alice');
});

test('rejects duplicate handles', async () => {
    await storage.setItem('user:taken', {
        handle: 'taken',
        name: 'Taken',
        created: Date.now(),
        password: 'hash',
        salt: 'salt',
        admin: false,
        enabled: true,
    });

    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'taken', password: 'new-pass' }),
    });

    expect(response.status).toBe(409);
});

test('rejects missing passwords', async () => {
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'nopass' }),
    });

    expect(response.status).toBe(400);
});

test('rejects registration when public registration is disabled', async () => {
    process.env.SILLYTAVERN_ENABLEPUBLICUSERREGISTRATION = 'false';

    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'blocked', password: 'pass-blocked' }),
    });

    expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm --prefix tests run test:unit -- public-registration.test.js`

Expected: FAIL because `/api/users/register` does not exist and returns 404.

### Task 2: Backend Public Registration Implementation

**Files:**
- Modify: `src/endpoints/users-public.js`

- [ ] **Step 1: Implement minimal backend route**

In `src/endpoints/users-public.js`, add imports for lodash, content initialization, and user helpers:

```js
import lodash from 'lodash';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import {
    KEY_PREFIX,
    getUserAvatar,
    toKey,
    getPasswordHash,
    getPasswordSalt,
    getAllUserHandles,
    getUserDirectories,
    ensurePublicDirectoriesExist,
} from '../users.js';
```

Add `isPublicRegistrationEnabled`, `slugify`, and `registerLimiter`, then add `router.post('/register', ...)` before login:

```js
const registerLimiter = new RateLimiterMemory({
    points: 5,
    duration: 300,
});

function isPublicRegistrationEnabled() {
    return getConfigValue('enableUserAccounts', false, 'boolean')
        && getConfigValue('enablePublicUserRegistration', false, 'boolean');
}

function slugify(text) {
    return lodash.deburr(String(text ?? '').toLowerCase().trim()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
```

The route must validate required fields, consume the rate limiter by IP, reject duplicates, create a non-admin user, initialize directories, set `request.session.handle`, and return `{ handle }`.

- [ ] **Step 2: Run backend tests to verify GREEN**

Run: `npm --prefix tests run test:unit -- public-registration.test.js`

Expected: PASS.

### Task 3: Login Page Registration Tests

**Files:**
- Modify: `tests/login-welcome.test.js`

- [ ] **Step 1: Write failing static tests**

Add tests that read `public/login.html` and `public/scripts/login.js`:

```js
test('offers public account registration from the login page', () => {
    const html = readProjectFile('public/login.html');

    expect(html).toContain('注册账号');
    expect(html).toContain('id="registrationBlock"');
    expect(html).toContain('id="registerHandle"');
    expect(html).toContain('id="registerPassword"');
    expect(html).toContain('id="registerConfirmPassword"');
});

test('submits registration to the public users register endpoint', () => {
    const script = readProjectFile('public/scripts/login.js');

    expect(script).toContain("fetch('/api/users/register'");
    expect(script).toContain('registerConfirmPassword');
    expect(script).toContain('Passwords do not match');
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm --prefix tests run test:unit -- login-welcome.test.js`

Expected: FAIL because the registration UI and script do not exist yet.

### Task 4: Login Page Registration Implementation

**Files:**
- Modify: `public/login.html`
- Modify: `public/scripts/login.js`
- Modify: `public/css/login.css`

- [ ] **Step 1: Add registration markup**

Add a hidden `#registerPrompt`, a `#registrationEntryBlock` with a "注册账号" button, and a hidden `#registrationBlock` with display name, handle, password, confirm password, register, and cancel controls.

- [ ] **Step 2: Add login script behavior**

In `public/scripts/login.js`, add:

```js
async function performRegistration(name, handle, password) {
    const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ name, handle, password }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    const data = await response.json();
    if (data.handle) {
        redirectToHome();
    }
}
```

Add validation for required handle/password, `/^[a-z0-9-]+$/`, and password confirmation before calling `performRegistration`.

- [ ] **Step 3: Add CSS for registration controls**

Extend the existing light login styles so `#registerButton`, `#cancelRegisterButton`, `#showRegisterButton`, `#registrationBlock`, and `#registerPrompt` are visually consistent and responsive.

- [ ] **Step 4: Run frontend/static tests to verify GREEN**

Run: `npm --prefix tests run test:unit -- login-welcome.test.js`

Expected: PASS.

### Task 5: Configuration

**Files:**
- Modify: `default/config.yaml`
- Modify: `config.yaml`
- Modify: `docker/config/config.yaml`

- [ ] **Step 1: Add config flag**

Add near `enableUserAccounts`:

```yaml
# Allows visitors on the login page to create regular user accounts.
enablePublicUserRegistration: false
```

For `config.yaml` and `docker/config/config.yaml`, set:

```yaml
enablePublicUserRegistration: true
```

- [ ] **Step 2: Run config diff check**

Run: `git diff --check -- default/config.yaml config.yaml docker/config/config.yaml`

Expected: no output and exit code 0.

### Task 6: Final Verification

**Files:**
- All modified feature files.

- [ ] **Step 1: Run targeted unit tests**

Run: `npm --prefix tests run test:unit -- public-registration.test.js login-welcome.test.js`

Expected: PASS.

- [ ] **Step 2: Run targeted ESLint**

Run: `./node_modules/.bin/eslint src/endpoints/users-public.js public/scripts/login.js tests/public-registration.test.js tests/login-welcome.test.js`

Expected: no lint errors.

- [ ] **Step 3: Run diff whitespace check**

Run: `git diff --check -- public/login.html public/css/login.css public/scripts/login.js src/endpoints/users-public.js default/config.yaml config.yaml docker/config/config.yaml tests/public-registration.test.js tests/login-welcome.test.js`

Expected: no output and exit code 0.
