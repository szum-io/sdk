# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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

[unreleased]: https://github.com/szum-io/sdk/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/szum-io/sdk/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/szum-io/sdk/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/szum-io/sdk/releases/tag/v1.0.0
