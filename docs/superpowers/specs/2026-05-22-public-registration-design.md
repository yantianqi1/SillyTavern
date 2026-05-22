# Public User Registration Design

## Goal

Allow any visitor to the public SillyTavern login page to create their own regular user account with a handle and password, then log in without administrator involvement.

## Current Context

- Docker deployment uses `docker/config/config.yaml` and `docker/data`.
- User accounts are enabled with `enableUserAccounts: true`.
- The public login page currently supports account listing, login, and password recovery.
- User creation currently exists only in the authenticated admin router at `POST /api/users/create`, protected by `requireAdminMiddleware`.

## Configuration

Add `enablePublicUserRegistration`.

- Default value: `false` in `default/config.yaml`.
- Enabled value: `true` in the active `config.yaml` and `docker/config/config.yaml`.
- When disabled, `POST /api/users/register` returns `403`.

## Backend

Add a public `POST /api/users/register` endpoint in `src/endpoints/users-public.js`.

Request body:

```json
{
  "handle": "alice",
  "name": "Alice",
  "password": "secret"
}
```

Rules:

- Registration is only available when `enableUserAccounts` and `enablePublicUserRegistration` are both true.
- `handle` and `password` are required.
- `name` is optional and falls back to the handle.
- Handles are normalized using the same slug behavior as admin user creation.
- Empty or invalid handles are rejected with `400`.
- Duplicate handles are rejected with `409`.
- New accounts are always `admin: false` and `enabled: true`.
- Passwords are stored with existing `getPasswordSalt()` and `getPasswordHash()`.
- User data directories are initialized the same way as admin-created users.
- Registration attempts are rate limited by client IP.
- On success, the endpoint sets `request.session.handle` and returns `{ "handle": "alice" }`.

## Frontend

Update `public/login.html`, `public/scripts/login.js`, and `public/css/login.css`.

Login page behavior:

- Add a "注册账号" action on the login screen.
- Show a registration form with display name, account handle, password, and confirm password.
- Provide a "返回登录" action to restore the normal login view.
- Validate required handle/password, handle format, and password confirmation before submitting.
- On successful registration, redirect to `/` using the same redirect helper as login.
- Existing normal login, discreet login, and password recovery flows remain unchanged.

## Error Handling

Frontend displays server errors in the existing `#errorMessage` area.

Expected server errors:

- `403`: public registration disabled.
- `400`: missing required fields or invalid handle.
- `409`: user already exists.
- `429`: too many registration attempts.
- `500`: unexpected server failure.

## Tests

Add focused unit tests.

Backend tests:

- Public registration creates a non-admin enabled user when enabled.
- Registration sets the session handle and returns the new handle.
- Duplicate handles fail with `409`.
- Missing password fails with `400`.
- Disabled public registration fails with `403`.

Frontend/static tests:

- Login page contains the registration entry point and fields.
- Login script calls `/api/users/register`.
- Register form validates confirmation password before submitting.

Verification commands:

```bash
npm run test:unit -- public-registration.test.js login-welcome.test.js
./node_modules/.bin/eslint src/endpoints/users-public.js public/scripts/login.js tests/public-registration.test.js tests/login-welcome.test.js
git diff --check -- public/login.html public/css/login.css public/scripts/login.js src/endpoints/users-public.js default/config.yaml config.yaml docker/config/config.yaml tests/public-registration.test.js tests/login-welcome.test.js
```
