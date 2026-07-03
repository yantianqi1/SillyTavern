import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sheetRoot = path.join(repoRoot, 'docker/data/sheet');

function listFiles(root) {
    if (!fs.existsSync(root)) {
        return [];
    }

    return fs.readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
}

describe('character store bundled folder', () => {
    test('keeps the bundled store empty except for the upload format guide', () => {
        const files = listFiles(sheetRoot);
        const relativeFiles = files.map(file => path.relative(sheetRoot, file).replaceAll(path.sep, '/'));

        expect(relativeFiles).toEqual(['README.md']);
        expect(relativeFiles.some(file => /\.(png|json)$/i.test(file))).toBe(false);
    });

    test('documents supported card, summary, and tag sidecar formats', () => {
        const readme = fs.readFileSync(path.join(sheetRoot, 'README.md'), 'utf8');

        expect(readme).toContain('PNG');
        expect(readme).toContain('JSON');
        expect(readme).toContain('.txt');
        expect(readme).toContain('.tag.txt');
        expect(readme).toContain('每行一个标签');
    });
});
