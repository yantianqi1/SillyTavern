import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('login welcome screen', () => {
    test('uses the Worry-Free Tavern Chinese welcome title instead of the default English copy', () => {
        const html = readProjectFile('public/login.html');

        expect(html).toContain('欢迎登录忘忧酒馆');
        expect(html).toContain('请输入账号密码');
        expect(html).not.toContain('SillyTavern');
        expect(html).not.toContain('img/logo.png');
        expect(html).not.toContain('class="logo"');
        expect(html).not.toContain('请选择账号');
        expect(html).not.toContain('Welcome to SillyTavern');
        expect(html).not.toContain('Select an Account');
    });

    test('defines light login styling and an embellished welcome title font', () => {
        const css = readProjectFile('public/css/login.css');

        expect(css).toMatch(/body\.login\s*\{[^}]*background:/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*background:/s);
        expect(css).toMatch(/body\.login\s+\.login-welcome-title\s*\{[^}]*font-family:/s);
    });

    test('uses an optimized background image and a smaller liquid glass login panel', () => {
        const css = readProjectFile('public/css/login.css');
        const optimizedBackgroundPath = path.join(repoRoot, 'public/img/login-background.jpg');

        expect(fs.existsSync(optimizedBackgroundPath)).toBe(true);
        const optimizedBackgroundSize = fs.statSync(optimizedBackgroundPath).size;
        expect(optimizedBackgroundSize).toBeLessThan(900 * 1024);
        expect(css).toContain('url("../img/login-background.jpg")');
        expect(css).not.toContain('url("../img/login-background.png")');
        expect(css).toMatch(/body\.login\s*\{[^}]*background-size:\s*cover/s);
        expect(css).toMatch(/body\.login\s*\{[^}]*background-position:\s*center center/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*width:\s*min\(480px,\s*calc\(100vw - 32px\)\)/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*backdrop-filter:\s*blur\(22px\) saturate\(170%\)/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup::before/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup::after/s);
    });

    test('centers the liquid glass login panel on desktop and mobile', () => {
        const css = readProjectFile('public/css/login.css');

        expect(css).toMatch(/body\.login\s+#shadow_popup\s*\{[^}]*justify-content:\s*center/s);
        expect(css).not.toMatch(/body\.login\s+#shadow_popup\s*\{[^}]*justify-content:\s*flex-end/s);
    });

    test('renders the login panel immediately without waiting for login JavaScript', () => {
        const html = readProjectFile('public/login.html');
        const script = readProjectFile('public/scripts/login.js');

        expect(html).toContain('id="shadow_popup"');
        expect(html).not.toContain('id="shadow_popup" style="opacity: 0;"');
        expect(html).not.toContain('id="handleEntryBlock" style="display:none;"');
        expect(html).not.toContain('id="passwordEntryBlock" style="display:none;"');
        expect(script).not.toContain('document.getElementById(\'shadow_popup\').style.opacity');
    });

    test('centers the login panel in the browser viewport without inherited popup offsets', () => {
        const css = readProjectFile('public/css/login.css');

        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*top:\s*auto/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*left:\s*auto/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*right:\s*auto/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*margin:\s*0/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*transform:\s*none/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\)/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*overflow-y:\s*auto/s);
    });

    test('offers public account registration from the login page', () => {
        const html = readProjectFile('public/login.html');

        expect(html).toContain('注册账号');
        expect(html).toContain('id="registrationBlock"');
        expect(html).toContain('id="registerHandle"');
        expect(html).toContain('id="registerPassword"');
        expect(html).toContain('id="registerConfirmPassword"');
    });

    test('localizes the password login controls in Chinese', () => {
        const html = readProjectFile('public/login.html');

        expect(html).toMatch(/id="userPassword"[^>]+placeholder="密码"/);
        expect(html).toContain('id="loginButton" class="menu_button">登录</div>');
        expect(html).not.toMatch(/id="userPassword"[^>]+placeholder="Password"/);
        expect(html).not.toContain('Forgot password?');
        expect(html).not.toContain('>Login</div>');
    });

    test('removes unavailable password recovery controls from the login page', () => {
        const html = readProjectFile('public/login.html');
        const script = readProjectFile('public/scripts/login.js');

        expect(html).not.toContain('忘记密码？');
        expect(html).not.toContain('id="recoverPassword"');
        expect(html).not.toContain('id="passwordRecoveryBlock"');
        expect(script).not.toContain('recoverPassword');
        expect(script).not.toContain('sendRecoveryPart');
        expect(script).not.toContain('passwordRecoveryBlock');
    });

    test('keeps the login action text horizontal', () => {
        const html = readProjectFile('public/login.html');
        const css = readProjectFile('public/css/login.css');

        expect(html).toContain('class="login-actions"');
        expect(css).toMatch(/body\.login\s+#loginButton\s*\{[^}]*min-width:\s*96px/s);
        expect(css).toMatch(/body\.login\s+#loginButton\s*\{[^}]*white-space:\s*nowrap/s);
    });

    test('uses typed account and password login instead of rendering user cards', () => {
        const html = readProjectFile('public/login.html');
        const script = readProjectFile('public/scripts/login.js');

        expect(html).toMatch(/id="userHandle"[^>]+placeholder="账号"/);
        expect(script).toContain('configureCredentialLogin');
        expect(script).toContain('const handle = String($(\'#userHandle\').val());');
        expect(script).toContain('const password = String($(\'#userPassword\').val());');
        expect(script).not.toContain('$(\'#userList\').append');
        expect(script).not.toContain('addClass(\'userSelect\')');
    });

    test('submits registration to the public users register endpoint', () => {
        const script = readProjectFile('public/scripts/login.js');

        expect(script).toContain('fetch(\'/api/users/register\'');
        expect(script).toContain('registerConfirmPassword');
        expect(script).toContain('Passwords do not match');
    });

    test('shows the API purchase announcement inline on login and registration panels', () => {
        const html = readProjectFile('public/login.html');

        expect(html).toContain('id="loginAnnouncement"');
        expect(html).toContain('id="registrationAnnouncement"');
        expect(html.match(/API购买地址/g)).toHaveLength(2);
        expect(html.match(/https:\/\/wang\.aihaochi\.com/g)).toHaveLength(4);
    });

    test('styles the announcement and registration actions for responsive mobile layout', () => {
        const html = readProjectFile('public/login.html');
        const css = readProjectFile('public/css/login.css');

        expect(html).toContain('class="registration-actions"');
        expect(css).toMatch(/body\.login\s+\.login-announcement\s*\{[^}]*box-shadow:/s);
        expect(css).toMatch(/body\.login\s+\.login-announcement\s*\{[^}]*border-radius:\s*8px/s);
        expect(css).toMatch(/body\.login\s+\.registration-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    });

    test('does not mount the announcement popup on login or home pages', () => {
        const loginHtml = readProjectFile('public/login.html');
        const indexHtml = readProjectFile('public/index.html');
        const mainScript = readProjectFile('public/script.js');

        expect(loginHtml).not.toContain('id="home_announcement_panel"');
        expect(loginHtml).not.toContain('initHomeAnnouncement');
        expect(loginHtml).not.toContain('css/home-announcement.css');
        expect(indexHtml).not.toContain('id="home_announcement_panel"');
        expect(indexHtml).not.toContain('css/home-announcement.css');
        expect(mainScript).not.toContain('initHomeAnnouncement');
    });
});
