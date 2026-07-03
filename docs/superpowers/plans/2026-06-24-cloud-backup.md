# Cloud Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily full-data backup and empty-deploy restore path for S3-compatible object storage.

**Architecture:** Add a focused `src/cloud-backup.js` module that zips/restores the whole `dataRoot`, signs S3-compatible HTTP requests with AWS Signature V4, uploads a fixed latest manifest, and schedules periodic backups after startup. Hook restore before `initUserStorage()` so restored accounts are available before login.

**Tech Stack:** Node.js ESM, `archiver`, `yauzl`, built-in `fetch`, `crypto`, Jest unit tests with fake local data roots.

---

### Task 1: Cloud Backup Core

**Files:**
- Create: `src/cloud-backup.js`
- Test: `tests/cloud-backup.test.js`

- [ ] Write failing tests for config normalization, dataRoot emptiness detection, local archive restore, and manifest key generation.
- [ ] Implement config parsing, zip creation, zip extraction, and S3 request signing helpers.
- [ ] Run targeted Jest tests and fix until green.

### Task 2: Startup Integration

**Files:**
- Modify: `src/server-main.js`
- Modify: `default/config.yaml`
- Modify: `docker/config/config.yaml`

- [ ] Add startup restore before `initUserStorage(globalThis.DATA_ROOT)`.
- [ ] Add periodic backup startup in post-setup after the server is listening.
- [ ] Document `cloudBackups` config keys in default configs.
- [ ] Run targeted tests and lint on touched files.
