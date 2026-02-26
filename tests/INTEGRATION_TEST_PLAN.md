# Integration Test Plan

This document catalogues every integration test scenario for the Web Downloader API.
Tests are grouped by API resource and map 1-to-1 to the files under `tests/integration/`.

---

## Folder structure

```
tests/
  INTEGRATION_TEST_PLAN.md        ← this file
  integration/
    helpers/
      app.ts          ← factory that builds a fresh Express app per suite (no shared state)
      env.ts          ← setEnv() / resetEnv() helpers to control process.env per suite
    auth.test.ts
    config.test.ts
    download.test.ts
    jobs.test.ts
    status.test.ts
    cancel.test.ts
    upload.test.ts
vitest.integration.config.ts      ← separate vitest config (longer timeout, no browser)
```

---

## POST /api/auth

| ID  | Scenario                                              | Expected status | Key assertion                                      |
|-----|-------------------------------------------------------|-----------------|----------------------------------------------------|
| A1  | Auth disabled (no `APP_PASSWORD`) → dummy token       | 200             | `body.token === "no-auth"`                         |
| A2  | Auth enabled, correct password → UUID token           | 200             | `body.token` matches UUID regex                    |
| A3  | Auth enabled, wrong password                          | 401             | `body.error === "Invalid password"`                |
| A4  | Auth enabled, missing `password` field in body        | 401             | `body.error === "Invalid password"`                |
| A5  | Rate-limit: 11th attempt within 15-minute window      | 429             | `body.error` contains "Too many login attempts"    |

---

## GET /api/config

| ID  | Scenario                                              | Expected status | Key assertion                                      |
|-----|-------------------------------------------------------|-----------------|----------------------------------------------------|
| C1  | No `Authorization` header when auth is enabled        | 401             | `body.error === "Unauthorized"`                    |
| C2  | Valid token, folders + extensions configured          | 200             | `body.folders` and `body.allowedExtensions` arrays |
| C3  | `DOWNLOAD_FOLDERS` not set                            | 200             | `body.folders` is `[]`                             |

---

## POST /api/download

| ID  | Scenario                                              | Expected status | Key assertion                                      |
|-----|-------------------------------------------------------|-----------------|----------------------------------------------------|
| D1  | Missing `url` field                                   | 400             | `body.error` contains "Missing required fields"    |
| D2  | Missing `folderKey` field                             | 400             | `body.error` contains "Missing required fields"    |
| D3  | Malformed URL (not parseable)                         | 400             | `body.error === "Invalid URL format"`              |
| D4  | Non-HTTP/HTTPS protocol (`ftp://example.com/f.zip`)   | 400             | `body.error` contains "Only HTTP and HTTPS"        |
| D5  | Internal IP (`http://192.168.1.1/file.jpg`)           | 400             | `body.error` contains "Internal/private IP"        |
| D6  | Invalid `folderKey` not in `DOWNLOAD_FOLDERS`         | 400             | `body.error` contains "Invalid folder key"         |
| D7  | Extension not in `ALLOWED_EXTENSIONS` (`.exe`)        | 400             | `body.error` contains "not allowed"                |
| D8  | Path traversal via `filenameOverride` (`../../passwd`)| 400             | `body.error === "Path traversal detected"`         |
| D9  | Valid request → job created                           | 200             | `body.id` is UUID, `body.status === "queued"`      |
| D10 | Valid request → job eventually reaches `done`         | poll 200        | `status === "done"` within 15 s (real small file)  |

---

## GET /api/jobs

| ID  | Scenario                                              | Expected status | Key assertion                                      |
|-----|-------------------------------------------------------|-----------------|----------------------------------------------------|
| J1  | No auth header when auth is enabled                   | 401             | `body.error === "Unauthorized"`                    |
| J2  | Returns array sorted by `created_at` descending       | 200             | `body[0].created_at >= body[1].created_at`         |
| J3  | Each job has required shape fields                    | 200             | `id, url, status, filename, folder_key` present    |

---

## GET /api/status/:jobId

| ID  | Scenario                                              | Expected status | Key assertion                                      |
|-----|-------------------------------------------------------|-----------------|----------------------------------------------------|
| S1  | Unknown job ID                                        | 404             | `body.error === "Job not found"`                   |
| S2  | Known job → correct response shape                    | 200             | `id, status, filename, folder_key` present         |

---

## DELETE /api/jobs/:jobId  (cancel)

| ID  | Scenario                                              | Expected status | Key assertion                                      |
|-----|-------------------------------------------------------|-----------------|----------------------------------------------------|
| X1  | Unknown job ID                                        | 404             | `body.error === "Job not found"`                   |
| X2  | Cancel a queued job                                   | 200             | `body.status === "cancelled"`                      |
| X3  | Cancel an already-done job                            | 400             | `body.error` contains "Cannot cancel"              |
| X4  | Cancel an already-cancelled job                       | 400             | `body.error` contains "Cannot cancel"              |

---

## POST /api/upload

| ID  | Scenario                                              | Expected status | Key assertion                                      |
|-----|-------------------------------------------------------|-----------------|----------------------------------------------------|
| U1  | No file attached                                      | 400             | `body.error === "No file provided"`                |
| U2  | Missing `folderKey`                                   | 400             | `body.error` contains "Missing required field"     |
| U3  | Invalid `folderKey`                                   | 400             | `body.error` contains "Invalid folder key"         |
| U4  | Extension not in `ALLOWED_EXTENSIONS`                 | 400             | `body.error` contains "not allowed"                |
| U5  | Valid upload → job created as done                    | 200             | `body.status === "done"`, `body.filename` present  |
| U6  | Valid upload → file actually written to disk          | 200             | `fs.existsSync(destPath)` is `true`                |
| U7  | `filenameOverride` is respected                       | 200             | `body.filename === sanitized(override)`            |

---

## Security / edge-case cross-cuts

| ID  | Scenario                                              | Covered by |
|-----|-------------------------------------------------------|------------|
| SEC1 | Path traversal in download `filenameOverride`        | D8         |
| SEC2 | SSRF via private IP in download URL                  | D5         |
| SEC3 | Non-HTTP protocol in download URL                    | D4         |
| SEC4 | Expired / forged Bearer token rejected               | C1, J1     |
| SEC5 | Rate-limit on `/api/auth`                            | A5         |

---

## Notes on test isolation

- Each test suite calls `buildApp()` from `helpers/app.ts` which creates a **fresh Express instance** with its own in-memory `jobs` Map — no state leaks between suites.
- `helpers/env.ts` saves and restores `process.env` around each suite so environment variables don't bleed across files.
- Real-network tests (D10) use a tiny public file (e.g. `https://httpbin.org/bytes/1024`) and poll `/api/status/:id` until `status !== "queued" && status !== "downloading"`.
- Upload tests write to a temp directory created with `fs.mkdtempSync` and cleaned up in `afterAll`.
