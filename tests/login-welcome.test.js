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
    test('uses the approved tavern landing copy instead of tool-like product wording', () => {
        const html = readProjectFile('public/login.html');
        const indexHtml = readProjectFile('public/index.html');

        expect(html).toContain('<title>爱玩酒馆</title>');
        expect(indexHtml).toContain('<title>爱玩酒馆</title>');
        expect(html).toContain('把今晚的故事留给爱玩');
        expect(html).toContain('欢迎来到你的深夜酒馆');
        expect(html).toContain('找个座位，今晚有人陪你聊。');
        expect(html).toContain('下班后的放空、睡前的一段闲谈、突然冒出来的脑洞');
        expect(html).toContain('随时开聊');
        expect(html).toContain('沉浸氛围');
        expect(html).toContain('老友回座');
        expect(html).toContain('请输入账号与密码，回到你的专属座位。');
        expect(html).toContain('进入酒馆');
        expect(html).toContain('爱玩补给站');
        expect(html).not.toContain('把创作、角色和模型接入放在一个可靠入口');
        expect(html).not.toContain('从角色卡管理到长线会话');
        expect(html).not.toContain('角色卡、聊天与素材管理统一进入');
        expect(html).not.toContain('模型补给');
        expect(html).not.toContain('大模型 APi 加油站');
        expect(html).not.toContain('SillyTavern');
        expect(html).not.toContain('img/logo.png');
        expect(html).not.toContain('class="logo"');
        expect(html).not.toContain('请选择账号');
        expect(html).not.toContain('Welcome to SillyTavern');
        expect(html).not.toContain('Select an Account');
    });

    test('defines a two-column product-style login layout', () => {
        const css = readProjectFile('public/css/login.css');

        expect(css).toMatch(/body\.login\s*\{[^}]*background:/s);
        expect(css).toMatch(/body\.login\s+#userSelectBlock\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(380px,\s*460px\)/s);
        expect(css).toMatch(/body\.login\s+\.login-brand-area\s*\{/s);
        expect(css).toMatch(/body\.login\s+\.login-signin-panel\s*\{/s);
        expect(css).toMatch(/body\.login\s+\.login-hero-title\s*\{[^}]*font-size:\s*clamp\(2\.6rem,\s*5vw,\s*5\.4rem\)/s);
    });

    test('uses an optimized background image and full-page product shell', () => {
        const css = readProjectFile('public/css/login.css');
        const optimizedBackgroundPath = path.join(repoRoot, 'public/img/login-background.jpg');

        expect(fs.existsSync(optimizedBackgroundPath)).toBe(true);
        const optimizedBackgroundSize = fs.statSync(optimizedBackgroundPath).size;
        expect(optimizedBackgroundSize).toBeLessThan(900 * 1024);
        expect(css).toContain('url("../img/login-background.jpg")');
        expect(css).not.toContain('url("../img/login-background.png")');
        expect(css).toMatch(/body\.login\s*\{[^}]*background-size:\s*cover/s);
        expect(css).toMatch(/body\.login\s*\{[^}]*background-position:\s*center/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*width:\s*min\(1180px,\s*calc\(100vw - 48px\)\)/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*display:\s*grid/s);
        expect(css).toMatch(/body\.login\s+\.login-signin-panel\s*\{[^}]*box-shadow:\s*var\(--login-shadow\)/s);
    });

    test('centers the product login shell on desktop and mobile', () => {
        const css = readProjectFile('public/css/login.css');

        expect(css).toMatch(/body\.login\s+#shadow_popup\s*\{[^}]*justify-content:\s*center/s);
        expect(css).toMatch(/body\.login\s+#shadow_popup\s*\{[^}]*align-items:\s*center/s);
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
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*min-height:\s*100dvh/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*overflow-y:\s*auto/s);
    });

    test('keeps the login shell from inheriting warm skin popup chrome', () => {
        const html = readProjectFile('public/login.html');
        const css = readProjectFile('public/css/login.css');

        expect(html.indexOf('css/login.css')).toBeLessThan(html.indexOf('css/user.css'));
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*background:\s*transparent\s*!important/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*box-shadow:\s*none\s*!important/s);
        expect(css).toMatch(/body\.login\s+#dialogue_popup\s*\{[^}]*color:\s*var\(--login-surface\)\s*!important/s);
    });

    test('gives the left landing copy a readable dark panel', () => {
        const css = readProjectFile('public/css/login.css');

        expect(css).toMatch(/body\.login\s+\.login-brand-area\s*\{[^}]*padding:\s*clamp\(24px,\s*4vw,\s*44px\)/s);
        expect(css).toMatch(/body\.login\s+\.login-brand-area\s*\{[^}]*background:\s*linear-gradient\(135deg,\s*rgba\(3,\s*12,\s*11,\s*0\.78\)/s);
        expect(css).toMatch(/body\.login\s+\.login-brand-area\s*\{[^}]*text-shadow:\s*0 2px 14px rgba\(0,\s*0,\s*0,\s*0\.38\)/s);
        expect(css).toMatch(/body\.login\s+\.login-proof-item\s*\{[^}]*background:\s*rgba\(5,\s*18,\s*16,\s*0\.52\)/s);
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

        expect(html).toMatch(/id="userPassword"[^>]+placeholder="请输入密码"/);
        expect(html).toContain('id="loginButton" class="primary-button menu_button">进入酒馆</button>');
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

        expect(html).toMatch(/id="userHandle"[^>]+placeholder="请输入账号"/);
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

    test('shows the Aiwan supply station announcement as a new-tab link on the login panel', () => {
        const html = readProjectFile('public/login.html');
        const css = readProjectFile('public/css/login.css');

        expect(html).toContain('id="loginApiAnnouncement"');
        expect(html).toContain('class="login-api-announcement"');
        expect(html).toContain('href="https://api.aiwanai.cc"');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain('爱玩补给站');
        expect(html).toContain('新朋友注册有体验礼');
        expect(html).toContain('每日签到和邀请好友还能领取更多聊天次数');
        expect(css).toContain('login-api-announcement');
        expect(css).toMatch(/body\.login\s+\.login-api-announcement\s*\{[^}]*grid-template-columns:\s*38px minmax\(0,\s*1fr\)/s);
        expect(html).not.toContain('https://wang.aihaochi.com');
    });

    test('styles registration actions for responsive mobile layout', () => {
        const html = readProjectFile('public/login.html');
        const css = readProjectFile('public/css/login.css');

        expect(html).toContain('class="registration-actions"');
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
