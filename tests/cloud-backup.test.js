import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from '@jest/globals';

const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'st-cloud-backup-'));
}

describe('cloud backup full data snapshots', () => {
    const roots = [];

    afterEach(() => {
        for (const root of roots.splice(0)) {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('detects an empty data root before startup restore', async () => {
        const { isDataRootEmptyForRestore } = await import('../src/cloud-backup.js');
        const root = makeTempRoot();
        roots.push(root);

        fs.writeFileSync(path.join(root, 'heartbeat.json'), '{}');
        fs.writeFileSync(path.join(root, 'access.log'), 'log line');

        expect(isDataRootEmptyForRestore(root)).toBe(true);

        fs.mkdirSync(path.join(root, '_storage'), { recursive: true });
        fs.writeFileSync(path.join(root, '_storage', 'user:alice'), '{}');

        expect(isDataRootEmptyForRestore(root)).toBe(false);
    });

    test('creates and restores a full data root archive with accounts and user files', async () => {
        const { createDataRootArchive, restoreDataRootArchive } = await import('../src/cloud-backup.js');
        const sourceRoot = makeTempRoot();
        const restoreRoot = makeTempRoot();
        roots.push(sourceRoot, restoreRoot);

        fs.mkdirSync(path.join(sourceRoot, '_storage'), { recursive: true });
        fs.mkdirSync(path.join(sourceRoot, 'alice', 'characters'), { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, '_storage', 'user:alice'), JSON.stringify({ handle: 'alice', password: 'hash' }));
        fs.writeFileSync(path.join(sourceRoot, 'alice', 'characters', 'hero.json'), '{"name":"Hero"}');

        const archivePath = path.join(os.tmpdir(), `st-cloud-backup-${Date.now()}.zip`);
        roots.push(archivePath);

        await createDataRootArchive(sourceRoot, archivePath);
        await restoreDataRootArchive(archivePath, restoreRoot);

        expect(JSON.parse(fs.readFileSync(path.join(restoreRoot, '_storage', 'user:alice'), 'utf8')).handle).toBe('alice');
        expect(fs.readFileSync(path.join(restoreRoot, 'alice', 'characters', 'hero.json'), 'utf8')).toBe('{"name":"Hero"}');
    });

    test('builds stable object keys under a single bucket prefix', async () => {
        const { getCloudBackupObjectKeys } = await import('../src/cloud-backup.js');

        expect(getCloudBackupObjectKeys({ prefix: 'sillytavern/prod' }, '20260624-120000')).toEqual({
            archiveKey: 'sillytavern/prod/backups/full-20260624-120000.zip',
            manifestKey: 'sillytavern/prod/latest.json',
        });
    });

    test('selects only older full backups beyond the retention count for deletion', async () => {
        const { getExpiredCloudBackupKeys } = await import('../src/cloud-backup.js');
        const keys = [
            'sillytavern/backups/full-20260620T000000Z.zip',
            'sillytavern/backups/full-20260621T000000Z.zip',
            'sillytavern/backups/full-20260622T000000Z.zip',
            'sillytavern/backups/full-20260623T000000Z.zip',
            'sillytavern/backups/full-20260624T000000Z.zip',
            'sillytavern/backups/full-20260625T000000Z.zip',
            'sillytavern/backups/full-20260626T000000Z.zip',
            'sillytavern/backups/full-20260627T000000Z.zip',
            'sillytavern/latest.json',
            'sillytavern/backups/readme.txt',
        ];

        expect(getExpiredCloudBackupKeys({ prefix: 'sillytavern', keepBackups: 7 }, keys)).toEqual([
            'sillytavern/backups/full-20260620T000000Z.zip',
        ]);
    });

    test('server startup restores before user storage initialization and schedules backups after startup', () => {
        const serverMain = fs.readFileSync(path.join(REPO_ROOT, 'src/server-main.js'), 'utf8');
        const restoreIndex = serverMain.indexOf('restoreFromCloudBackupIfEnabled(globalThis.DATA_ROOT)');
        const initIndex = serverMain.indexOf('initUserStorage(globalThis.DATA_ROOT)');
        const scheduleIndex = serverMain.indexOf('startCloudBackupScheduler(globalThis.DATA_ROOT)');

        expect(restoreIndex).toBeGreaterThan(-1);
        expect(initIndex).toBeGreaterThan(-1);
        expect(restoreIndex).toBeLessThan(initIndex);
        expect(scheduleIndex).toBeGreaterThan(-1);
    });

    test('default config exposes empty S3-compatible cloud backup settings', () => {
        const defaultConfig = fs.readFileSync(path.join(REPO_ROOT, 'default/config.yaml'), 'utf8');

        expect(defaultConfig).toContain('cloudBackups:');
        expect(defaultConfig).toContain('endpoint: ""');
        expect(defaultConfig).toContain('bucket: ""');
        expect(defaultConfig).toContain('accessKeyId: ""');
        expect(defaultConfig).toContain('secretAccessKey: ""');
        expect(defaultConfig).toContain('retention:');
        expect(defaultConfig).toContain('keepBackups: 7');
        expect(defaultConfig).toContain('restore:');
        expect(defaultConfig).toContain('mode: "emptyDataRootOnly"');
    });

    test('docker config enables S3-compatible cloud backups for deployment', () => {
        const dockerConfig = fs.readFileSync(path.join(REPO_ROOT, 'docker/config/config.yaml'), 'utf8');

        expect(dockerConfig).toContain('cloudBackups:');
        expect(dockerConfig).toContain('enabled: true');
        expect(dockerConfig).toContain('endpoint: "http://45.205.31.37:9000"');
        expect(dockerConfig).toContain('bucket: "aiwan-sillytavern-docker-data"');
        expect(dockerConfig).toContain('accessKeyId:');
        expect(dockerConfig).toContain('secretAccessKey:');
        expect(dockerConfig).toContain('intervalHours: 24');
        expect(dockerConfig).toContain('retention:');
        expect(dockerConfig).toContain('keepBackups: 7');
        expect(dockerConfig).toContain('restore:');
        expect(dockerConfig).toContain('mode: "emptyDataRootOnly"');
    });
});
