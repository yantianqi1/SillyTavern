import { initAccessibility } from './a11y.js';

/**
 * CRSF token for requests.
 */
let csrfToken = '';
let discreetLogin = false;

/**
 * Gets a CSRF token from the server.
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch('/csrf-token');
    const data = await response.json();
    return data.token;
}

/**
 * Gets a list of users from the server.
 * @returns {Promise<object>} List of users
 */
async function getUserList() {
    const response = await fetch('/api/users/list', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    if (response.status === 204) {
        discreetLogin = true;
        return [];
    }

    const userListObj = await response.json();
    console.log(userListObj);
    return userListObj;
}

/**
 * Attempts to log in the user.
 * @param {string} handle User's handle
 * @param {string} password User's password
 * @returns {Promise<void>}
 */
async function performLogin(handle, password) {
    const userInfo = {
        handle: handle,
        password: password,
    };

    try {
        const response = await fetch('/api/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify(userInfo),
        });

        if (!response.ok) {
            const errorData = await response.json();
            return displayError(errorData.error || 'An error occurred');
        }

        const data = await response.json();

        if (data.handle) {
            console.log(`Successfully logged in as ${handle}!`);
            redirectToHome();
        }
    } catch (error) {
        console.error('Error logging in:', error);
        displayError(String(error));
    }
}

/**
 * Registers a new user and logs them in.
 * @param {string} name Display name
 * @param {string} handle User handle
 * @param {string} password Password
 * @returns {Promise<void>}
 */
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
        console.log(`Successfully registered as ${handle}!`);
        redirectToHome();
    }
}

/**
 * Gets and validates registration form data.
 * @returns {{name: string, handle: string, password: string}|null} Registration form data
 */
function getRegistrationFormData() {
    const name = String($('#registerName').val()).trim();
    const handle = String($('#registerHandle').val()).trim();
    const password = String($('#registerPassword').val());
    const confirmPassword = String($('#registerConfirmPassword').val());

    if (!handle) {
        displayError('User handle is required');
        return null;
    }

    if (!/^[a-z0-9-]+$/.test(handle)) {
        displayError('User handle can only contain lowercase letters, numbers, and dashes');
        return null;
    }

    if (!password) {
        displayError('Password is required');
        return null;
    }

    if (password !== confirmPassword) {
        displayError('Passwords do not match');
        return null;
    }

    return { name, handle, password };
}

/**
 * Handles the registration button click.
 * @returns {Promise<void>}
 */
async function onRegisterClick() {
    const formData = getRegistrationFormData();
    if (!formData) {
        return;
    }

    await performRegistration(formData.name, formData.handle, formData.password);
}

/**
 * Displays an error message to the user.
 * @param {string} message Error message
 */
function displayError(message) {
    $('#errorMessage').text(message);
}

/**
 * Redirects the user to the home page.
 * Preserves the query string.
 */
function redirectToHome() {
    // Create a URL object based on the current location
    const currentUrl = new URL(window.location.href);

    // After a login there's no need to preserve the
    // noauto parameter (if present)
    currentUrl.searchParams.delete('noauto');

    // Set the pathname to root and keep the updated query string
    currentUrl.pathname = '/';

    // Redirect to the new URL
    window.location.href = currentUrl.toString();
}

/**
 * Shows the public registration form.
 */
function showRegistrationBlock() {
    $('#userListBlock').hide();
    $('#registrationEntryBlock').hide();
    $('#normalLoginPrompt').hide();
    $('#discreetLoginPrompt').hide();
    $('#registerPrompt').show();
    $('#registrationBlock').show();
    displayError('');
    $('#registerHandle').trigger('focus');
}

/**
 * Restores the login form from the public registration form.
 */
function showLoginBlock() {
    $('#registrationBlock').hide();
    $('#registerPrompt').hide();
    $('#userListBlock').show();
    $('#registrationEntryBlock').show();
    configureCredentialLogin({ discreet: discreetLogin });
    displayError('');
}

/**
 * Configures the login page to use typed account credentials.
 * @param {{discreet?: boolean}} [options] Login display options
 */
function configureCredentialLogin({ discreet = false } = {}) {
    console.log(discreet ? 'Discreet login is enabled' : 'Discreet login is disabled');
    $('#handleEntryBlock').show();
    $('#passwordEntryBlock').show();
    $('#userList').hide().empty();
    $('#normalLoginPrompt').toggle(!discreet);
    $('#discreetLoginPrompt').toggle(discreet);
    $('#loginButton').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const password = String($('#userPassword').val());
        await performLogin(handle, password);
    });

    $('#userHandle').trigger('focus');
}

(async function () {
    initAccessibility();

    csrfToken = await getCsrfToken();
    await getUserList();

    configureCredentialLogin({ discreet: discreetLogin });
    $('#showRegisterButton').on('click', showRegistrationBlock);
    $('#cancelRegisterButton').on('click', showLoginBlock);
    $('#registerButton').on('click', onRegisterClick);
    $(document).on('keydown', (evt) => {
        if (evt.key === 'Enter' && document.activeElement.tagName === 'INPUT') {
            if ($('#registrationBlock').is(':visible')) {
                $('#registerButton').trigger('click');
            } else {
                $('#loginButton').trigger('click');
            }
        }
    });
})();
