# Clasificados Online (CO) Ingestion

## TL;DR

Clasificados Online (CO) is an automated scraping pipeline that ingests residential
property listings from [clasificadosonline.com](https://www.clasificadosonline.com)
into the Amplia MLS database. It runs as an AWS Lambda pair:

- **Coordinator** — discovers brokerage offices and dispatches them to an SQS FIFO queue.
- **Worker** — consumes one office at a time, scrapes its listings, and writes RESO rows.

CO data lives in two layers:

1. **Staging layer** (raw scrape state): `External_Office`, `External_Member`, `External_Property`.
2. **RESO layer** (clean, queryable): standard Amplia tables (`Property`, `Member`,
   `Office`, `PriceGroup`, `DatesGroup`, `MediaGroup`, `PropertyFeaturesTable`,
   `HistoryTransactional`, etc.) with `OriginatingSystemNameId = 3`.

Two EventBridge schedules drive scraping:

- `DiscoverOffices` — daily at 04:00 UTC. Walks the CO main page, finds new brokerage
  offices, refreshes listing counts, enqueues offices with `totalListings > 0`.
- `RefreshExistingOffices` — every 12h at :30. Dispatches every `External_Office`
  with `scrapingStatus = 'ACTIVE'` without touching the CO main page.

## How to identify CO data (the canonical filter)

CO is **`OriginatingSystemNameId = 3`**. Every analytical query about CO listings,
agents, offices, or changes must filter on this.

| Table              | CO filter                                                             |
| ------------------ | --------------------------------------------------------------------- |
| `Property`         | `OriginatingSystemNameId = 3`                                         |
| `Member`           | `OriginatingSystemNameId = 3`                                         |
| `Office`           | `OriginatingSystemNameId = 3`                                         |
| `External_Office`  | every row is CO by definition (no filter needed)                      |
| `External_Member`  | every row is CO by definition                                         |
| `External_Property`| every row is CO by definition                                         |

**Join bridge from CO ID to RESO ListingKey:**

```sql
External_Property.ListingKey = Property.ListingKey
```

`External_Property.externalSourceId` is the human-readable CO listing ID visible in
the URL (`detail.asp?ID=12345`).

**Relevant timestamps** (all stored as UTC):

| Timestamp                                | Meaning                                                   |
| ---------------------------------------- | --------------------------------------------------------- |
| `External_Property.firstSeen`            | First time the scraper ingested this listing (= upload)   |
| `External_Property.lastSeen`             | Most recent scrape run that still found the listing       |
| `External_Property.lastScrapedAt`        | Alias of lastSeen; updated on every successful scrape     |
| `External_Office.lastScrapedAt`          | Most recent worker run for the office                     |
| `Property.ModificationTimestamp`         | RESO-level last modification                              |
| `DatesGroup.PriceChangeTimestamp`        | Last price change                                         |
| `DatesGroup.WithdrawnDate` / `OffMarketDate` | Set when the worker stamps a listing as Withdrawn     |
| `HistoryTransactional.ModificationTimestamp` | When a specific field-level audit event was recorded  |

Amplia stores timestamps in UTC. Convert to AST for display:
`CONVERT_TZ(ts, '+00:00', '-04:00')`.

## Lifecycle states

### Staging status (`External_Property.scrapingStatus`)

- `ACTIVE` — the listing link was seen in the most recent worker run for its office.
- `INACTIVE` — the link disappeared from the office page. The worker stamps the
  listing Withdrawn on the RESO side when this transition happens.

### RESO Standard Status (via `PropertyFeaturesTable`)

`Property.StandardStatusKey` **does not exist** — RESO status is an EAV feature:

```
PropertyFeaturesTable (ListingKey, FeatureKey)
  → FeatureKey → Lookup.LookupKey
                  → Lookup.LookupNameId → LookupName.Id (LookupName.LookupName = 'StandardStatus')
```

CO listings are born `Incomplete` (they come from a public HTML directory, not an
authoritative MLS feed, so they can't be marked `Active`). The only status transition
the worker emits today is:

- `Incomplete → Withdrawn` (when the CO link disappears).

Future reactivation (Withdrawn → Incomplete) is not implemented.

### Listings that **never** land in the DB

The worker skips some listings before any DB write. Analysts hunting for "missing"
listings should know these exist only in Lambda logs and the per-run performance metrics:

| Skip reason             | Log format                            | Metric              | Why                                                                 |
| ----------------------- | ------------------------------------- | ------------------- | ------------------------------------------------------------------- |
| Non-residential type    | `SKIPPED \| {Comercial\|Finca\|Solar}` | `skippedNonResidential` | These property types are out of scope for Amplia's residential MLS |
| No parseable agent      | `SKIPPED \| no-agent \| <id>`         | `skippedNoAgent`    | `HistoryTransactional.ChangedByMemberKey` is non-null by schema — no real agent means no auditable ingestion |

Result: no `External_Property`, no `Property`, no `PriceGroup`, no `DatesGroup`,
no audit row. Running a count of CO listings will never include these.

## Change audit model

The worker's content-hash change detection drives two DB-visible outcomes:

### 1. Price change

When `External_Property.rawData.hashInput.price` differs from the scraped price:

- `PriceGroup.ListPrice` → new price
- `PriceGroup.PreviousListPrice` → old price
- `PriceGroup.ListPriceLow` → only moves downward; initialized to the new price on
  first price change if previously NULL
- `PriceGroup.OriginalListPrice` → immutable, set on first ingestion
- `DatesGroup.PriceChangeTimestamp` / `MajorChangeTimestamp` / `ModificationTimestamp` → now()
- `DatesGroup.MajorChangeTypeId` → Id of the `MajorChangeType` row where
  `MajorChangeType = 'Price Change'`
- `HistoryTransactional` row:
  - `ResourceId = 3` (Property)
  - `ResourceRecordKey = Property.ListingKey`
  - `ChangeTypeLookupKey` → `Lookup` row with `LookupValue = 'Price Change'`
  - `FieldLookupKey` → `Lookup` row with `LookupValue = 'List Price'`
  - `PreviousValue` / `NewValue` = stringified prices
  - `ChangedByMemberKey` = the real scraped agent

### 2. Withdrawal (listing disappears from CO)

- `PropertyFeaturesTable` — the Incomplete StandardStatus feature is replaced with Withdrawn
- `DatesGroup.WithdrawnDate` / `OffMarketDate` / `OffMarketTimestamp` /
  `StatusChangeTimestamp` / `MajorChangeTimestamp` / `ModificationTimestamp` → now()
- `DatesGroup.MajorChangeTypeId` → Id of the `MajorChangeType` row where
  `MajorChangeType = 'Withdrawn'`
- `External_Property.scrapingStatus` → `INACTIVE`
- `HistoryTransactional` row:
  - `ChangeTypeLookupKey` → `Lookup.LookupValue = 'Withdrawn'`
  - `FieldLookupKey` → `Lookup.LookupValue = 'Standard Status'`
  - `PreviousValue = 'Incomplete'`, `NewValue = 'Withdrawn'`

### What is NOT audited

The worker rewrites beds, baths, photos, description, and property type whenever the
content hash changes, but only price changes and withdrawals get a `HistoryTransactional`
row. Hash-only jitter (description whitespace, photo count drift from ads) updates
`External_Property.rawData` but emits **no** audit row.

## Querying CO data — cookbook

All queries assume Amplia's conventions: UTC timestamps, AST display via
`CONVERT_TZ(..., '+00:00', '-04:00')`, and the `OriginatingSystemNameId = 3` filter.
Because `HistoryTransactional.ChangeTypeLookupKey` and `.FieldLookupKey` are both
FKs to `Lookup.LookupKey` (not to `MajorChangeType`), filtering by change type goes
through `Lookup`.

### How many CO listings were uploaded in the last N days?

"Uploaded" = first appeared on the scraper (`External_Property.firstSeen`). This
is the correct answer — RESO `Property` rows can pre-exist from a different feed
and get linked in later.

```sql
SELECT COUNT(*) AS new_co_listings
FROM External_Property ep
JOIN Property p ON p.ListingKey = ep.ListingKey
WHERE p.OriginatingSystemNameId = 3
  AND ep.firstSeen >= NOW() - INTERVAL 7 DAY;
```

Time-bucketed (daily) upload count:

```sql
SELECT DATE(CONVERT_TZ(ep.firstSeen, '+00:00', '-04:00')) AS upload_day_ast,
       COUNT(*) AS new_listings
FROM External_Property ep
JOIN Property p ON p.ListingKey = ep.ListingKey
WHERE p.OriginatingSystemNameId = 3
  AND ep.firstSeen >= NOW() - INTERVAL 30 DAY
GROUP BY upload_day_ast
ORDER BY upload_day_ast;
```

### Per-office breakdown of uploads / active / inactive

```sql
SELECT eo.externalSourceId AS co_office_id,
       eo.name AS office_name,
       SUM(CASE WHEN ep.firstSeen >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS new_last_7d,
       SUM(CASE WHEN ep.scrapingStatus = 'ACTIVE' THEN 1 ELSE 0 END) AS active_now,
       SUM(CASE WHEN ep.scrapingStatus = 'INACTIVE' THEN 1 ELSE 0 END) AS inactive_total,
       MAX(ep.lastScrapedAt) AS office_last_scrape_utc
FROM External_Office eo
LEFT JOIN External_Property ep ON ep.externalOfficeId = eo.id
GROUP BY eo.id, eo.externalSourceId, eo.name
ORDER BY new_last_7d DESC;
```

### Which CO listings had a price change in the last N days?

```sql
SELECT ep.externalSourceId AS co_listing_id,
       ht.ResourceRecordKey AS ListingKey,
       ht.PreviousValue AS old_price,
       ht.NewValue AS new_price,
       ht.ChangedByMemberKey,
       CONVERT_TZ(ht.ModificationTimestamp, '+00:00', '-04:00') AS changed_at_ast
FROM HistoryTransactional ht
JOIN External_Property ep ON ep.ListingKey = ht.ResourceRecordKey
JOIN Property p ON p.ListingKey = ht.ResourceRecordKey
JOIN Lookup change_type ON change_type.LookupKey = ht.ChangeTypeLookupKey
WHERE p.OriginatingSystemNameId = 3
  AND change_type.LookupValue = 'Price Change'
  AND ht.ModificationTimestamp >= NOW() - INTERVAL 7 DAY
ORDER BY ht.ModificationTimestamp DESC;
```

### Which CO listings were withdrawn in the last N days?

```sql
SELECT ep.externalSourceId AS co_listing_id,
       ht.ResourceRecordKey AS ListingKey,
       ht.ChangedByMemberKey,
       CONVERT_TZ(ht.ModificationTimestamp, '+00:00', '-04:00') AS withdrawn_at_ast
FROM HistoryTransactional ht
JOIN External_Property ep ON ep.ListingKey = ht.ResourceRecordKey
JOIN Property p ON p.ListingKey = ht.ResourceRecordKey
JOIN Lookup change_type ON change_type.LookupKey = ht.ChangeTypeLookupKey
WHERE p.OriginatingSystemNameId = 3
  AND change_type.LookupValue = 'Withdrawn'
  AND ht.ModificationTimestamp >= NOW() - INTERVAL 7 DAY
ORDER BY ht.ModificationTimestamp DESC;
```

### Every audit event for a specific CO listing

Given a CO listing ID (e.g. `22412-123456`):

```sql
SELECT CONVERT_TZ(ht.ModificationTimestamp, '+00:00', '-04:00') AS when_ast,
       change_type.LookupValue AS change_type,
       field.LookupValue AS field_changed,
       ht.PreviousValue,
       ht.NewValue,
       ht.ChangedByMemberKey
FROM External_Property ep
JOIN HistoryTransactional ht ON ht.ResourceRecordKey = ep.ListingKey
JOIN Lookup change_type ON change_type.LookupKey = ht.ChangeTypeLookupKey
JOIN Lookup field ON field.LookupKey = ht.FieldLookupKey
WHERE ep.externalSourceId = '22412-123456'
ORDER BY ht.ModificationTimestamp;
```

### How many CO listings are currently active vs inactive?

```sql
SELECT scrapingStatus, COUNT(*) AS n
FROM External_Property
GROUP BY scrapingStatus;
```

### Who (agent / office) does a CO listing belong to?

```sql
SELECT ep.externalSourceId AS co_listing_id,
       p.ListingKey,
       CONCAT(m.MemberFirstName, ' ', m.MemberLastName) AS agent_name,
       m.MemberStateLicense AS agent_license,
       m.MemberDirectPhone AS agent_phone,
       o.OfficeName AS office_name
FROM External_Property ep
JOIN Property p ON p.ListingKey = ep.ListingKey
LEFT JOIN Member m ON m.MemberKey = p.ListAgentKey
LEFT JOIN Office o ON o.OfficeKey = p.ListOfficeKey
WHERE p.OriginatingSystemNameId = 3
  AND ep.externalSourceId = '22412-123456';
```

### Most recently scraped CO offices

```sql
SELECT externalSourceId AS co_office_id,
       name,
       saleCount,
       rentCount,
       CONVERT_TZ(lastScrapedAt, '+00:00', '-04:00') AS last_scrape_ast
FROM External_Office
WHERE scrapingStatus = 'ACTIVE'
ORDER BY lastScrapedAt DESC
LIMIT 20;
```

### Summary counts for the last scrape window (rolling 24h)

```sql
SELECT
  (SELECT COUNT(*) FROM External_Property ep
   JOIN Property p ON p.ListingKey = ep.ListingKey
   WHERE p.OriginatingSystemNameId = 3
     AND ep.firstSeen >= NOW() - INTERVAL 24 HOUR)       AS uploaded_last_24h,
  (SELECT COUNT(*) FROM HistoryTransactional ht
   JOIN Property p ON p.ListingKey = ht.ResourceRecordKey
   JOIN Lookup l ON l.LookupKey = ht.ChangeTypeLookupKey
   WHERE p.OriginatingSystemNameId = 3
     AND l.LookupValue = 'Price Change'
     AND ht.ModificationTimestamp >= NOW() - INTERVAL 24 HOUR) AS price_changes_last_24h,
  (SELECT COUNT(*) FROM HistoryTransactional ht
   JOIN Property p ON p.ListingKey = ht.ResourceRecordKey
   JOIN Lookup l ON l.LookupKey = ht.ChangeTypeLookupKey
   WHERE p.OriginatingSystemNameId = 3
     AND l.LookupValue = 'Withdrawn'
     AND ht.ModificationTimestamp >= NOW() - INTERVAL 24 HOUR) AS withdrawals_last_24h;
```

## Gotchas and invariants

- `Property.StandardStatusKey` does **not** exist. RESO status lives in
  `PropertyFeaturesTable` via the EAV pattern (see `databases/amplia-mysql.md`).
- `HistoryTransactional.ChangeTypeLookupKey` and `.FieldLookupKey` are FKs to
  `Lookup.LookupKey`, **not** to `MajorChangeType`. Filter via `Lookup.LookupValue`.
- `DatesGroup.MajorChangeTypeId` is the only place that joins to `MajorChangeType`.
- Hash-only changes (description whitespace, photo count jitter) update
  `External_Property.rawData` but emit **no** `HistoryTransactional` row — they are
  not visible in the audit log.
- No-agent listings never reach the DB. Don't expect `External_Property` rows for
  CO listings whose public page has no license / phone / name. They show up only
  as `SKIPPED | no-agent` log lines and the `skippedNoAgent` performance metric.
- Every `HistoryTransactional.ChangedByMemberKey` on a CO audit row references a
  real `Member` row. There is no synthetic system-member fallback.
- Amplia timestamps are UTC. Always wrap displayed times in
  `CONVERT_TZ(ts, '+00:00', '-04:00')` for AST.
- Freshness bound: listings are refreshed at most every ~12h
  (`RefreshExistingOffices`). Brand-new brokerage offices appear on the daily
  `DiscoverOffices` run (04:00 UTC) or by manual seeding.
- `ORIGINATING_SYSTEM_ID` mapping for reference: `1 = Keller Williams`, `2 = AMPLIA`
  (native), `3 = ClasificadosOnline`.
