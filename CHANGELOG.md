# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `charts.getDocumentState()` returns `sharedTheme`, the name of the shared theme the published document is linked to, or `null` when it has none or the theme was deleted. Pass it back to `charts.update()` to keep the link; an update without `sharedTheme` ends it.

### Changed

- Validation results and failures from a later Szum release no longer reject the response. Fields this SDK doesn't know are accepted at every level. A diagnostic `severity` or compatibility `classification` it doesn't know comes back as a plain string, so the generated `ChartDiagnostic` and compatibility types now include `string` for them; give a `switch` over them a default case. A malformed value Szum already defines is still rejected.
- An error code this SDK doesn't know keeps its server `code`, `message`, and `retryable` on the `SzumError` (with `failure: null`), instead of falling back to the HTTP status text. `retryable: false` on such an error now stops retries.

## [4.2.0] - 2026-10-21

### Added

- `themes.list()` returns the workspace's shared themes, the default first, and `defaultBuiltInTheme` when new charts start in one of Szum's built-in themes instead. A personal workspace returns no themes. `WorkspaceTheme` and `WorkspaceThemes` describe the result.
- `charts.create()` and `charts.update()` accept `sharedTheme`, the name of one of a Team workspace's shared themes, and link the chart to it. `SavedChartUpdateOptions` describes the update options.
- `charts.list()` accepts `author`, an `authorId` from a listed chart or `"former"` for charts whose author has left the workspace. Each listed chart carries `authorId` and `authorName`.
- Validation and render diagnostics type the `workspace_rule` code, whose details list the accepted themes in `allowedThemes` and chart types in `allowedChartTypes`.

### Changed

- Documents Szum returns are checked for their shape only: `charts.getDocumentState()`, `charts.getDocuments()`, a `validateChart()` result's `suggestedDocument`, and the `suggestedDocument` of an error. A document that uses chart types or options from a later Szum release is returned as it is instead of rejecting the response. Documents you send are still validated in full by Szum.

### Fixed

- Diagnostics from a later Szum release, such as an unfamiliar code, reason, or detail, are returned instead of rejecting the render or validation response.

## [4.1.0] - 2026-10-13

### Added

- Generated types and strict document guards now accept `waterfall` on the existing `2026-09-26` chart contract, including `focus: "changes"` and optional `labels.position`. Existing chart documents retain their version and meaning.
- Generated types and strict document guards now accept `currency`, an ISO 4217 code, on long and wide values, pie values, and waterfall values. Szum writes that role's numbers as money in the chart `locale`, such as `$416B`. Validation rejects a value role that sets both `currency` and `format`.

### Fixed

- `charts.getDocumentState()`, `charts.getDocuments()`, and a `validateChart()` suggested document no longer reject waterfall documents or documents that use `currency`. SDK 4.0.0 throws an invalid-response error for them.

## [4.0.0] - 2026-09-27

### Breaking changes

- The minimum supported Node.js version is now 24.
- Automatic sizing is bounded by the shared renderer without dropping source rows.

- HTTP failures use a structured `error` object and a single `diagnostics` list, aligned with MCP. `SzumError.issues` is replaced by `diagnostics`; `failure` retains the complete validated response and server error codes survive subclass selection. Completed validation results remain distinct from operational failures.

- Replaced the `2026-03-20` mark-list grammar with the purpose-based `2026-09-26` chart contract. `ChartConfig`, `ChartConfigInput`, and `SCHEMA_VERSION` now describe the new active vocabulary.
- Theme categorical palettes and sequential or diverging ranges now author one complete array per scheme: a bare array applies to both schemes, while `{ light, dark }` may provide either or both complete arrays. Scalar colors retain their per-color Light/Dark form.
- Sequential color ranges accept two or three stops, while diverging ranges accept three or five, across chart encodings and theme overrides.
- `render()` and `renderWithMetadata()` now accept a complete `ChartDocument` (`config` plus `data`, with optional size, output, and presentation policy) instead of a config that owns mark data and output fields.
- Saved-chart writes now accept the same complete document: `charts.create(document)` and `charts.update(id, document)`. Current authored and generated input types are exported as `ChartDocument` and `ChartDocumentInput`.
- Replaced config reads with document reads: `charts.getDocument()` is now `charts.getDocumentState()`, and `charts.getConfigs()` is now `charts.getDocuments()`. `charts.getConfig()` is removed because document state is the durable resource.
- Saved-chart metadata now exposes `documentUrl` instead of `configUrl`, and validation returns `suggestedDocument` instead of `suggestedConfig`.

### Changed

- Generated chart-document, saved-chart, validation, diagnostic, and render-metadata types are synchronized from the current public contracts.
- `validateChart()` accepts the same current document used for rendering and saving and preserves its document-oriented diagnostic projection.

### Fixed

- Preserve and validate compatibility classifications and loss codes; decode suggested and saved documents against generated current schemas instead of casting untrusted objects.
- Keep request timeouts active through response bodies, wrap body connection failures, and clean up cancellation listeners after retry waits.
- Reject blank create idempotency keys, invalid per-call timeouts, and batch replies that omit, duplicate, or substitute requested chart IDs.
- Honor numeric and HTTP-date `Retry-After` values without timer overflow; normalize trailing slashes in custom base URLs.

### Migration from 3.x

SDK 4 requires Node.js 24 or newer and implements the `2026-09-26` chart contract. A 3.x config cannot be upgraded by changing its version string, and the SDK does not rewrite retained chart definitions automatically.

In 3.x, configuration, data, and output lived in one mark-oriented config:

```typescript
const config = {
  version: "2026-03-20",
  format: "png",
  theme: "editorial",
  marks: [
    {
      type: "barY",
      data: [
        { x: "Q1", y: 4.2 },
        { x: "Q2", y: 5.1 },
      ],
    },
  ],
};

await szum.render(config);
await szum.charts.create(config);
```

In 4.0, one purpose-based `ChartDocument` is shared by validation, rendering, and saved-chart writes:

```typescript
import type { ChartDocument } from "@szum-io/sdk";

const document = {
  config: {
    type: "column",
    theme: "editorial",
    category: { field: "quarter" },
    values: { type: "long", field: "revenue" },
  },
  data: [
    { quarter: "Q1", revenue: 4.2 },
    { quarter: "Q2", revenue: 5.1 },
  ],
  output: { format: "png" },
} satisfies ChartDocument;

await szum.render(document);
await szum.charts.create(document);
```

Update each renamed API and response field:

| 3.x                          | 4.0                                              |
| ---------------------------- | ------------------------------------------------ |
| `render(config)`             | `render(document)`                               |
| `renderWithMetadata(config)` | `renderWithMetadata(document)`                   |
| `validateChart(config)`      | `validateChart(document)`                        |
| `charts.create(config)`      | `charts.create(document)`                        |
| `charts.update(id, config)`  | `charts.update(id, document)`                    |
| `charts.getConfig(id)`       | `(await charts.getDocumentState(id)).document`   |
| `charts.getDocument(id)`     | `charts.getDocumentState(id)`                    |
| `charts.getConfigs(ids)`     | `charts.getDocuments(ids)`                       |
| `configUrl`                  | `documentUrl`                                    |
| `suggestedConfig`            | `suggestedDocument`                              |
| validation `errors`          | `diagnostics` filtered by `severity === "error"` |
| `SzumError.issues`           | `SzumError.diagnostics`                          |

`ChartConfig` is now data-free. Use authored `ChartDocument` when versions may be omitted and generated `ChartDocumentInput` when both the document and nested config versions must be explicit.

Errors preserve the validated failure envelope on `SzumError.failure`. Use the broad error subclass for transport handling, then inspect `error.code` for operation-specific cases such as `not_found`, `conflict`, `limit_reached`, or `validation_failed`; `error.retryable` reports the server's retry classification.

Review custom color configuration during conversion. Scalar colors may still provide independent `light` and `dark` members. Theme categorical palettes and continuous ranges instead provide one complete array per authored scheme. Sequential ranges accept two or three stops; diverging ranges accept three or five.

## [3.2.0] - 2026-08-07

### Added

- `locale` in chart configs for locale-aware number and date formatting.
- `"log"` scales and the `nice` option on X and Y axes.
- Exported `SavedChartListParams` for `charts.list()` filters and pagination.
- Anonymous `validateChart()` with generated validation result and diagnostic types.
- `renderWithMetadata()` for usage headers, content type, and font fallback.
- `charts.getDocument()` for published config, draft, publication state, and title.
- Optional `title` support in `charts.create()`.
- Structured chart diagnostics on `SzumError.issues`.

### Changed

- Generated chart types now expose the supported Google Fonts allowlist for font-family overrides.
- Chart-schema, saved-chart, validation, and render-metadata types are synchronized from Szum's canonical public contracts.
- Saved-chart list, document, and batch responses are decoded strictly instead of silently defaulting or dropping malformed fields.
- Network failures are wrapped as `SzumConnectionError`; safe requests retry retryable create conflicts, gateway failures, and connection failures. Metered renders retry only `429` to avoid a second charge after an ambiguous failure.
- `"unavailable"` batch results are documented as storage or stored-data failures, not always safe to retry.

## [3.1.0] - 2026-06-18

### Added

- `charts.rename(id, title)` – rename a chart by id. Metadata-only: the config isn't touched and the id, `/c/`, and `/e/` URLs are unchanged. Returns the updated chart object.
- `charts.list()` gains two filters: `sort` (`"created"` (default), `"updated"`, or `"title"`) and `q` (case-insensitive title substring search). When `q` is set, the returned page also carries `total` (the exact match count). The `cursor` is keyset-coupled to the active `sort`, so keep `sort` stable while paging.
- Each `charts.list()` item now carries `hasDraft` (the chart has unpublished edits) on top of the chart object – exposed as the new `SavedChartListItem` type.
- `SavedChart` gains `publishedAt` – an ISO-8601 publish timestamp, or `null` when the chart's public URLs are dark (a never-published draft, or one that's been unpublished). Returned by `create`, `get`, `update`, `rename`, and each `list` item.
- Exported types: `SavedChartListItem`, `SavedChartSort`.

### Notes

- Resyncs `src/generated` against the current chart schema (additive `themeOverrides`, `attribution`, `footer`, and mark fields, all within the same `2026-03-20` schema version).

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

[unreleased]: https://github.com/szum-io/sdk/compare/v4.2.0...HEAD
[4.2.0]: https://github.com/szum-io/sdk/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/szum-io/sdk/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/szum-io/sdk/compare/v3.2.0...v4.0.0
[3.2.0]: https://github.com/szum-io/sdk/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/szum-io/sdk/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/szum-io/sdk/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/szum-io/sdk/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/szum-io/sdk/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/szum-io/sdk/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/szum-io/sdk/releases/tag/v1.0.0
