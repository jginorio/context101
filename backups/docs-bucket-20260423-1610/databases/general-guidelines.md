# Metabase Database Context: Findit and Amplia MLS

This document describes how to query the two MySQL databases accessible via the Metabase MCP, and lists query guidelines specific to each.

## Databases

- **Findit** (`find-it-prod`)
- **Amplia MLS** (`amplia-prod`)
- **Amplia MLS Staging** (`amplia-staging`)

Most questions involve inventory (for-sale / for-rent properties), users, agents, offices, and saved searches.

## Query Guidelines

### Findit

1. **Qualify agent/office joins with the `mls` column** to avoid cross-MLS ID collisions.
2. **`listings.status` is the correct column name** (not `listing_status`). It maps to `listings_status.id`.
3. **Pricing lives in `listings_pricing.price`**, not on the `listings` table itself.
4. **Address lives in `listings_address`**, not on the `listings` table itself.

### Amplia

1. **Timestamps are stored in UTC** — convert to AST (`-04:00`) for display.
2. **Use the lookup subquery pattern** (shown above) for any Amplia property feature. Don't try to join `PropertyFeaturesTable` directly without the `LookupName` filter.
3. **`GROUP BY ListingKey` in feature subqueries** to handle potential multi-value features and avoid row duplication.
4. **Prefer `LEFT JOIN` for all group tables** — not every listing has data in every group.
