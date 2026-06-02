# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [3.0.0] - 2026-06-02

### Breaking changes

- `charts.create()` now returns the full chart object instead of `{ url, embedUrl, id }`. The rendered-image URL is renamed **`url` → `imageUrl`** (`embedUrl` and `id` are unchanged); the object also gains `source`, `title`, `createdAt`, `updatedAt`, `sizeBytes`, and `configUrl`.
- `charts.delete()` is now idempotent: deleting an already-deleted or never-existed id resolves instead of throwing `404`. Non-`404` errors still throw.

### Added

- New `charts` read methods:
  - `charts.get(id)` – one chart's metadata.
  - `charts.list({ source?, cursor?, limit? })` – one keyset page (`{ items, nextCursor }`), newest first. `source` accepts one or several of `"api"` / `"app"` / `"figma"` / `"mcp"`; `limit` defaults to 100 (max 1000).
  - `charts.getConfig(id)` – a chart's config.
  - `charts.getConfigs(ids)` – batch config read (max 100 ids); returns `{ configs, missing }`, where each `missing` entry carries a `reason` (`"not_found"` or `"unavailable"`, the latter safe to retry).
  - `charts.update(id, config)` – replace a config in place (same id and URLs; invalidates CDN cache).
- `charts.create()` is retry-safe: it sends an auto-generated `Idempotency-Key` (reused across the call's automatic retries) so a committed-but-timed-out create can't duplicate the chart. Pass `options.idempotencyKey` (now on `RequestOptions`) to dedupe across calls.
- Exported types: `SavedChart`, `SavedChartPage`, `SavedChartSource`, `SavedChartConfigs`, `ConfigMissingReason`.

### Migration

```diff
- const { url, id } = await szum.charts.create(config);
+ const { imageUrl, id } = await szum.charts.create(config);

  // delete is idempotent now – a redundant or timed-out delete no longer throws 404:
- try { await szum.charts.delete(id); } catch (e) { /* ignore 404 */ }
+ await szum.charts.delete(id);
```

## [2.1.0] - 2026-05-21

### Added

- `charts.create()` now returns `embedUrl` alongside the existing `url` and `id`. The new field points at `https://szum.io/e/<id>` – an interactive HTML page (tooltips, legend toggle, responsive resize).

## [2.0.0] - 2026-04-25

### Breaking changes

- Removed `signedUrl(config, options)`. The HMAC signed-URL system has been retired on the server.
- Added a `charts` namespace as the replacement:
  - `charts.create(config, options)` posts to `POST /api/charts` and returns `{ url, id }`. The URL points at `https://szum.io/c/<id>` and resolves to a rendered chart image. Same auth/error semantics as `render()`.
  - `charts.delete(id, options)` posts to `DELETE /api/charts/<id>` to revoke a single chart by id.

### Migration

```diff
- const url = await szum.signedUrl(config);
+ const { url, id } = await szum.charts.create(config);

// Revoke later (new):
+ await szum.charts.delete(id);
```

## [1.0.1] - 2026-04-23

### Added

- Optional `tickLabelFontWeight` in `themeOverrides`.

### Fixed

- `fetchWithTimeout` no longer calls `Date.now()` unless `SZUM_DEBUG=true`, fixing Next.js 16 `cacheComponents` pre-render warnings in Server Components.

## [1.0.0] - 2026-04-19

### Added

- `Szum` client with `render()` (returns SVG/PNG bytes) and `signedUrl()`.
- Typed error hierarchy: `SzumError` base plus `SzumAuthenticationError`, `SzumPermissionError`, `SzumInvalidRequestError`, `SzumRateLimitError`, `SzumAPIError`, `SzumConnectionError`.
- Automatic retry with exponential backoff + jitter for `429`, `502`, `503`, `504`, and network errors. `Retry-After` is honored on `429`.
- Constructor options: `apiKey`, `baseUrl`, `timeout`, `maxRetries`.
- Per-call `RequestOptions`: `timeout`, `signal` (`AbortSignal` support).
- `requestId` surfaced on every `SzumError`.
- `toJSON()` on every error class.
- Server-only runtime guard – constructor throws if instantiated in a browser (prevents API-key leakage).
- `SZUM_DEBUG=true` env var for request/response logging to `stderr`.
- `SCHEMA_VERSION` export tied to the chart schema version the SDK was built against.

[unreleased]: https://github.com/szum-io/sdk/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/szum-io/sdk/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/szum-io/sdk/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/szum-io/sdk/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/szum-io/sdk/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/szum-io/sdk/releases/tag/v1.0.0
