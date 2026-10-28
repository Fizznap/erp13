# Snippet object storage migration plan

**Status:** planning only. No storage provider, production file, or production metadata was changed as part of this audit.

## Current storage behavior

- Faculty/admin uploads are written by Multer to `UPLOAD_DIR` (defaults to `./uploads`).
- The `resources.file_path` column stores a local filesystem path. Resource rows and extracted chunks live in PostgreSQL.
- `/api/resources/:id/download` checks resource authorization before streaming the file. The legacy `/uploads` static mount is now admin-only in the local code changes from this audit.
- Render configuration describes the upload directory as ephemeral. A restart or redeploy can therefore leave resource rows in PostgreSQL while their original PDF is unavailable.

## Target design

Use an S3-compatible private bucket and keep PostgreSQL as the source of truth for resource metadata and class/offering authorization. Store a stable object key (for example, `resources/<resource-uuid>/<random-file-id>.pdf`) rather than a public URL. Add explicit storage metadata such as `storage_provider`, `storage_key`, `sha256`, and `storage_state`; retain `file_path` during migration and rollback.

The API must authorize a resource before issuing a short-lived signed download URL or proxying the object. Do not make the bucket public. Upload limits, allowed PDF content, safe generated keys, and `Content-Disposition` must be enforced server-side. Any presigned upload must be short-lived and constrained by object key, content type, and size.

## Phased rollout

1. **Preparation:** choose a provider/region and private bucket; define IAM credentials with least privilege; configure lifecycle, encryption, versioning, backups, and alerting. Keep credentials server-side as Render secrets. Agree on retention and recovery objectives.
2. **Code and schema:** add an idempotent additive migration for storage metadata. Add a storage adapter with local and S3-compatible implementations. Keep authorization in the existing Express resource routes; never trust a client-supplied object key or resource scope.
3. **New uploads:** write to a unique object key, compute size and SHA-256, and only then persist the resource row and object metadata. If persistence fails, remove the just-created object. Keep existing local reads available while migrating.
4. **Backfill:** enumerate resource rows with local paths in bounded batches. For each existing file, stream it to the bucket, verify the uploaded byte count and SHA-256 against the local source, then update only that resource's storage metadata in a transaction. Do not delete local files during this phase. Record per-resource outcomes and make retries idempotent.
5. **Validation:** compare counts, sizes, and hashes; test authorized and unauthorized downloads, faculty/admin uploads, class isolation, missing-object behavior, and restore from backup in a staging environment. Review orphan-object and failed-migration reports before switching reads.
6. **Cutover:** enable object reads for verified rows behind a reversible feature flag. Monitor download failures, upload failures, latency, storage errors, and provider costs. Keep local fallback during a defined observation window.
7. **Cleanup:** only after sign-off and a verified backup/restore exercise, schedule a separate cleanup of migrated local files. This audit does not authorize that deletion.

## Rollback

- Keep `file_path` and source files until cutover is accepted.
- If object reads fail, disable the object-read flag and use local paths for records whose files remain available.
- If a row update fails during backfill, leave it pointing at the local file and retry later; do not publish a partially verified object as authoritative.
- If new-upload cutover is rolled back, route new writes to local storage and continue serving already-migrated objects through the adapter. Do not delete bucket objects as part of rollback.
- Keep an audit log of resource IDs, old/new metadata, size, hashes, and migration outcome, without logging credentials or signed URLs.

## Access, backup, and operations

- Private bucket; TLS in transit and provider-managed encryption at rest; narrowly scoped service credentials; rotation and access logging.
- Signed download URLs should be short-lived and created only after `canAccessResource` succeeds. Never persist signed URLs in PostgreSQL or expose bucket credentials in browser code.
- Back up object data separately from PostgreSQL metadata. Enable versioning or an equivalent recovery mechanism, and regularly test restoring an object and its matching resource metadata.
- Track storage bytes, request volume, egress, lifecycle transitions, failed uploads, missing objects, and signed-URL issuance. Set budget alerts before enabling broad backfill.

## Cost and operational impact

Costs depend on the chosen provider and region, file volume, retention, request frequency, and download egress. Estimate storage, PUT/GET requests, egress, replication/versioning, backup, and migration traffic before selection. The change adds a provider dependency, credentials, monitoring, backup procedures, and incident handling; it removes the current dependence on an ephemeral application filesystem.

## Approval gate

Before execution, approve the provider/region, bucket and retention policy, migration window, estimated cost, backup/restore evidence, and rollback owner. This document alone does not authorize provisioning, data transfer, metadata updates, or deletion of local files.
