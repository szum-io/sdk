# @szum-io/sdk

The official TypeScript SDK for [Szum](https://szum.io), the chart design system.

Describe a chart once, as a JSON document. Szum renders it as an SVG or PNG for emails, PDFs, Slack and reports, or saves it behind a stable image URL and an interactive embed. Saved charts share one library with charts made in Studio, the Figma plugin and AI assistants, so the same document can move between code, design and conversation.

![Electric car sales by region, a stacked area chart in Szum's technical theme](assets/hero.png)

## Install

```bash
npm install @szum-io/sdk
```

Requires Node.js 24 or newer.

The `Szum` client sends your API key with every request, so it runs on the server only and refuses to start in a browser. Save charts on the server and pass their URLs to the client.

## Render a chart

A `ChartDocument` holds the chart's config, the rows it reads, and optional size and output settings. The config says what the chart means – an area chart of sales by year, one series per region – and the theme decides how it looks. This document draws the chart above:

```typescript
import { writeFile } from "node:fs/promises";
import { Szum, type ChartDocument } from "@szum-io/sdk";

const szum = new Szum({ apiKey: process.env.SZUM_API_KEY! });

const evSales = {
  config: {
    type: "area",
    theme: "technical",
    title: "Electric car sales by region",
    subtitle: "Global, 2020–2024 (millions)",
    caption:
      "Source: IEA Global EV Outlook 2025, via [Our World in Data](https://ourworldindata.org/grapher/electric-car-sales)",
    headerAlign: "center",
    curve: "monotone",
    category: { field: "year", scale: { type: "utc" }, format: "%Y" },
    values: {
      type: "long",
      field: "sales",
      series: {
        field: "region",
        domain: ["China", "Europe", "United States", "Rest of World"],
      },
      format: "~s",
    },
    categoryAxis: { format: "%Y" },
    valueAxis: { format: "~s" },
    color: {
      domain: ["China", "Europe", "United States", "Rest of World"],
      range: ["#23314c", "#b84233", "#c2902f", "#868e96"],
    },
    labels: { series: { content: ["series", "value"] } },
  },
  data: [
    { year: "2020", region: "China", sales: 1_150_000 },
    { year: "2021", region: "China", sales: 3_250_000 },
    { year: "2022", region: "China", sales: 6_000_000 },
    { year: "2023", region: "China", sales: 8_200_000 },
    { year: "2024", region: "China", sales: 11_300_000 },
    { year: "2020", region: "Europe", sales: 1_380_000 },
    { year: "2021", region: "Europe", sales: 2_300_000 },
    { year: "2022", region: "Europe", sales: 2_600_000 },
    { year: "2023", region: "Europe", sales: 3_200_000 },
    { year: "2024", region: "Europe", sales: 3_190_000 },
    { year: "2020", region: "United States", sales: 294_000 },
    { year: "2021", region: "United States", sales: 630_000 },
    { year: "2022", region: "United States", sales: 990_000 },
    { year: "2023", region: "United States", sales: 1_390_000 },
    { year: "2024", region: "United States", sales: 1_520_000 },
    { year: "2020", region: "Rest of World", sales: 156_000 },
    { year: "2021", region: "Rest of World", sales: 420_000 },
    { year: "2022", region: "Rest of World", sales: 610_000 },
    { year: "2023", region: "Rest of World", sales: 910_000 },
    { year: "2024", region: "Rest of World", sales: 1_470_000 },
  ],
  size: { type: "canvas", width: 640, height: 380 },
  output: { format: "png", scale: 3 },
} satisfies ChartDocument;

await writeFile("ev-sales.png", await szum.render(evSales));
```

Szum has seven chart types – column, bar, line, area, scatter, pie and waterfall – and six themes: editorial, clean, noir, loud, soft and technical. The [chart model](https://szum.io/docs/chart-model) explains the roles a config can use, and each chart type has its own page in the docs.

Without a `size`, a chart sizes itself to fit its data, up to 4096 pixels per axis. PNG `scale` (1–4, default 2) sharpens the image without changing its layout. The SDK fills in the document and config `version` when you leave them out.

`render` returns the image bytes. `renderWithMetadata` returns the same bytes with what Szum reported about the render:

```typescript
const { data, contentType, diagnostics, fontFallback, usage } =
  await szum.renderWithMetadata(evSales);
```

`diagnostics` lists adjustments made while drawing, such as labels left out because they didn't fit. `fontFallback` is `true` when a requested font wasn't available. `usage` is the account's render meter: `{ used, limit, remaining, overage }`.

## Validate before you render

Validation is free and changes nothing:

```typescript
import { validateChart } from "@szum-io/sdk";

const result = await validateChart(evSales);

if (!result.valid) {
  for (const diagnostic of result.diagnostics) {
    console.error(diagnostic.path, diagnostic.message);
  }
}
```

`validateChart` needs no API key. The result has `valid` and one `diagnostics` list; a valid chart can still carry warnings and suggestions. Each diagnostic has a stable `code`, a `severity`, a JSON Pointer `path` into the document, a `message` and code-specific `details`. An older config also gets a `compatibility` report.

When Szum knows a deterministic fix, the result includes `suggestedDocument`, a complete document that has already passed validation. The SDK never applies it for you: review it, and validate again only if you change it.

`szum.validate(document)` runs the same check with your API key. In a Team workspace, that also checks the chart against the workspace's chart rules. Their findings use the `workspace_rule` code, and a rule set to Block makes the chart invalid.

## Save and embed

Saving stores the document and publishes it behind stable URLs:

```typescript
const chart = await szum.charts.create(evSales, {
  title: "Electric car sales",
});

chart.imageUrl; // https://szum.io/c/<id> – for an <img> tag
chart.embedUrl; // https://szum.io/e/<id> – for an <iframe>
```

`imageUrl` serves the same image on every request; add `.png` or `.svg` to force a format. `embedUrl` serves an interactive page with tooltips, a legend that toggles series, and a responsive layout. Both keep working when the chart changes, because they name the chart, not a render.

A chart object carries `id`, `source`, `title`, `createdAt`, `updatedAt`, `sizeBytes`, `publishedAt`, `imageUrl`, `embedUrl` and `documentUrl`. `publishedAt` is `null` while the chart's public URLs are switched off.

```typescript
await szum.charts.update(chart.id, nextYear); // new document, same id and URLs
await szum.charts.rename(chart.id, "EV sales by region"); // title only
await szum.charts.get(chart.id);
await szum.charts.delete(chart.id); // also resolves when the chart is already gone
```

`update` keeps a chart's library title when it was renamed; a title that still comes from the document follows the new document. Pass `title` to set it, or an empty string to take the document's.

To replace only the version you read, pass its `updatedAt`:

```typescript
const current = await szum.charts.get(chart.id);

await szum.charts.update(chart.id, nextYear, {
  expectedUpdatedAt: current.updatedAt,
});
```

If the chart was published or renamed since, `update` rejects with a `409` `conflict` and changes nothing; read it again and decide what to do.

`create` is safe to retry. Each call sends its own idempotency key and reuses it across its automatic retries, so a create that timed out after Szum saved it doesn't make a second chart. Pass `idempotencyKey` to keep one key across separate calls or processes.

### List charts

```typescript
const page = await szum.charts.list({
  source: ["api", "mcp"],
  sort: "updated",
  q: "revenue",
  limit: 50,
});

page.items; // charts, each with hasDraft, authorId and authorName
page.nextCursor; // pass back as `cursor`; null on the last page
page.total; // exact match count, present when `q` is set
```

Charts list newest first by default; `sort` also takes `"updated"` and `"title"`. `q` matches titles without regard to case. `limit` defaults to 100, up to 1000. A cursor belongs to one sort order, so keep `sort` the same while paging.

## Charts made in Studio, Figma and AI assistants

Charts saved from Studio, the Figma plugin and AI assistants list beside your API charts, with `source` saying where each came from (`"app"`, `"figma"`, `"mcp"` or `"api"`). In Studio, a chart can have unpublished edits saved as a draft next to the published version.

```typescript
const { document, draft, publishedAt, title, sharedTheme } =
  await szum.charts.getDocumentState(id);

const { documents, missing } = await szum.charts.getDocuments(ids);
```

`getDocumentState` returns the published document and the draft separately, and `document` is `null` for a chart that was never published. `getDocuments` reads up to 100 charts in one request and returns the draft where one exists, for previews. Each entry in `missing` has a `reason`, today `"not_found"` or `"unavailable"`. `"unavailable"` means the stored chart couldn't be read, and a retry may not help.

`update` refuses with `409` while a chart has a Studio draft. Publish or discard the draft in Studio first.

## Team workspaces

An API key belongs to one workspace, and every call acts on it. A Team workspace can share named themes and set chart rules for everyone in it.

```typescript
const { themes, defaultBuiltInTheme } = await szum.themes.list();

await szum.render(evSales, { sharedTheme: "Brand" });

const chart = await szum.charts.create(evSales, { sharedTheme: "Brand" });
await szum.charts.update(chart.id, evSales, { sharedTheme: "Brand" });

const { items } = await szum.charts.list({ author: authorId });
const { items: orphaned } = await szum.charts.list({ author: "former" });
```

- **Shared themes.** `themes.list` returns the workspace's shared themes, the default first. Pass a theme's `name` as `sharedTheme`; names match regardless of case, and a name the workspace doesn't have fails with the list of names it does have.
- **Linked charts.** A saved chart linked to a shared theme follows it: when an admin edits the theme, the chart's image and embed change too. `getDocumentState` returns the linked theme's name in `sharedTheme`. An update without `sharedTheme` keeps the link unless the document sets a different theme of its own, so updating the document you read keeps it. Pass `sharedTheme: null` to end the link and keep the document's own theme.
- **The default theme.** A document that sets neither `theme` nor `themeOverrides` uses the workspace's default theme. `defaultBuiltInTheme` names that default when it's one of Szum's built-in themes rather than a shared one. Pass `sharedTheme: null` to `create` to start a chart without it.
- **Chart rules.** A render that breaks a rule set to Block fails with `validation_failed`. Rules set to Warn come back in the render's `diagnostics`. Run `szum.validate` to check a chart against the rules before rendering it.
- **Authors.** Each listed chart has an `authorId` (`null` when unknown) and an `authorName` (`"Former member"` once the author has left). Filter with an `authorId`, or with `"former"` for charts whose author has left.

A personal workspace has no shared themes and no chart rules.

## Client options

```typescript
const szum = new Szum({
  apiKey: process.env.SZUM_API_KEY!,
  baseUrl: "https://szum.io", // default
  timeout: 30_000, // ms per attempt, default 30 s
  maxRetries: 2, // default 2
});

const controller = new AbortController();

await szum.render(evSales, {
  timeout: 60_000,
  signal: controller.signal,
});
```

Every method takes these options last. `timeout` covers one attempt, including reading the whole response body, so retries can make a call take longer. `signal` cancels the whole call, including any wait between retries, and the call rejects with the signal's reason.

Validation, reads and saved-chart writes retry `429`, `502`, `503`, `504`, network failures, and a create `409` whose key is still being processed. They wait for `Retry-After` when Szum sends it, in seconds or as an HTTP date, and back off exponentially otherwise. Renders retry only `429`: a render that timed out or hit a gateway error may already have been charged, so the SDK never sends a second one on its own. A failure marked `retryable: false` is never retried.

Set `SZUM_DEBUG=true` to log every request, response status, timing and retry to stderr.

## Errors

Every failed call rejects with a subclass of `SzumError`:

| Class                     | When                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `SzumAuthenticationError` | `401` – missing or invalid API key                                         |
| `SzumPermissionError`     | `403` – for example, a feature your plan doesn't include                   |
| `SzumInvalidRequestError` | Other `4xx`, or an invalid argument caught before sending, with status `0` |
| `SzumRateLimitError`      | `429`                                                                      |
| `SzumAPIError`            | `5xx`, or a response the SDK can't read                                    |
| `SzumConnectionError`     | Timeout or network failure, with status `0`                                |

```typescript
import { SzumError, SzumRateLimitError } from "@szum-io/sdk";

try {
  await szum.render(evSales);
} catch (error) {
  if (error instanceof SzumRateLimitError) {
    // Try again in error.retryAfter seconds
  } else if (error instanceof SzumError && error.code === "validation_failed") {
    console.error(error.diagnostics);
  } else {
    throw error;
  }
}
```

A `SzumError` has the server's `code` (such as `validation_failed`, `plan_required` or `not_found`), `message`, HTTP `status`, `retryable`, `retryAfter` in seconds, `requestId` and, for chart problems, `diagnostics`. `failure` holds the complete response, `{ error: { code, message, retryable, details? }, diagnostics?, compatibility?, suggestedDocument? }`, typed for the error codes this SDK knows. Include `requestId` when you contact support. Errors serialize with `JSON.stringify`, so loggers and error trackers record every field.

`validateChart` and `szum.validate` resolve with an invalid result when the chart is wrong. They reject only when the check couldn't run.

Two failures aren't a `SzumError`. The `Szum` constructor throws a plain `Error` for a missing API key or an invalid option. A call cancelled through `signal` rejects with the signal's reason.

## Compatibility

SDK 4 implements Szum's `2026-09-26` chart contract, exported as `SCHEMA_VERSION`. Szum adds fields, values and error codes to that contract over time, and the SDK reads responses from later releases without failing:

- Fields the SDK doesn't know are kept as they arrive.
- A diagnostic `severity`, compatibility classification, missing `reason` or chart `source` the SDK doesn't know comes back as a plain string. Give a `switch` over these values a default case.
- An error code the SDK doesn't know still sets `code`, `message` and `retryable`, with `failure` set to `null`.
- Documents that Szum returns are checked for their shape only, so a document with chart types or options from a later release comes back as it is.

Upgrading from 3.x? See the [migration guide](CHANGELOG.md#migration-from-3x).

## Types

All types are exported from the package root.

- **Documents:** `ChartDocument`, `ChartConfig`, and `ChartDocumentInput` and `ChartConfigInput`, which require `version`
- **Validation:** `ChartValidationResult`, `ChartDiagnostic`
- **Rendering:** `RenderOptions`, `RenderResult`, `RenderMetadata`, `RenderUsage`
- **Saved charts:** `SavedChart`, `SavedChartListItem`, `SavedChartPage`, `SavedChartListParams`, `SavedChartSort`, `SavedChartSource`, `SavedChartDocumentState`, `SavedChartDocuments`, `DocumentMissingReason`, `SavedChartCreateParams`, `SavedChartCreateOptions`, `SavedChartUpdateParams`, `SavedChartUpdateOptions`
- **Themes:** `WorkspaceTheme`, `WorkspaceThemes`
- **Errors:** `SzumError` and its subclasses, `ApiFailure`, `ApiError`
- **Options:** `SzumOptions`, `RequestOptions`, `ValidationOptions`

## Documentation

- [What is Szum](https://szum.io/docs/what-is-szum)
- [Chart model](https://szum.io/docs/chart-model) and [themes](https://szum.io/docs/themes)
- [Validation](https://szum.io/docs/validation) and [errors](https://szum.io/docs/errors)
- [Saved charts](https://szum.io/docs/saved-charts) and [interactive embeds](https://szum.io/docs/interactive-embeds)
- [Team workspaces](https://szum.io/docs/teams)
- [HTTP API](https://szum.io/docs/api)
