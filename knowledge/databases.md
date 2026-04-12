# Metabase — Database Context Prompt

You have access to two MySQL databases via the Metabase MCP: **Findit** (`find-it-prod`) and **Amplia MLS** (`amplia-prod`). Most questions involve inventory (for-sale/for-rent properties), users, agents, offices, and saved searches.

---

## Findit (`find-it-prod`)

### Listings

The core table is `listings`. Every property lives here.

| Column                   | Points to                                                                 | Meaning                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `mls`                    | `mls.id`                                                                  | Property source. `NULL` = manually posted on Findit. `1` = Xposure MLS, `2` = Stellar MLS, `3` = Amplia MLS.                              |
| `status`                 | `listings_status.id`                                                      | 1 = Vendido/Vendida, 2 = Alquilado/Alquilada, 3 = En Alquiler, 4 = En Venta, 5 = Opcionado (under contract), 6 = Removido, 7 = Archivado. |
| `listing_type`           | `listing_type.id`                                                         | 1 = Venta (sale), 2 = Alquiler (rent).                                                                                                    |
| `listing_home_type`      | `listing_home_type.id`                                                    | Residential property type (Casa, Apartamento, etc.).                                                                                      |
| `property_type`          | `property_type.id`                                                        | Broader property classification (default 1).                                                                                              |
| `landlord_id`            | `users.id`                                                                | Set when a user posted the listing manually on Findit. Mutually exclusive with `mls_agent_id`.                                            |
| `mls_agent_id`           | (joins to `mls_agents.id` via `mls_agents.mls_agent_id` + matching `mls`) | Set when the listing comes from an MLS feed. Mutually exclusive with `landlord_id`.                                                       |
| `added_on`               | —                                                                         | Timestamp when listing was created.                                                                                                       |
| `mls_listing_id`         | —                                                                         | The listing ID in the originating MLS system.                                                                                             |
| `numero_catastro`        | —                                                                         | Cadastral number.                                                                                                                         |
| `3d_tour` / `video_tour` | —                                                                         | Tour URLs.                                                                                                                                |

**Key rule:** A listing has _either_ `landlord_id` (manual post, `mls` is NULL) _or_ `mls_agent_id` (MLS feed, `mls` is NOT NULL), never both.

**Status logic:**

- **Sold** = `listing_type = 1` (Venta) + `status = 1` (Vendido/Vendida)
- **Under contract** = `listing_type = 1` + `status = 5` (Opcionado)
- **Rented** = `listing_type = 2` (Alquiler) + `status = 2` (Alquilado/Alquilada)
- **Active for sale** = `listing_type = 1` + `status = 4` (En Venta)
- **Active for rent** = `listing_type = 2` + `status = 3` (En Alquiler)

### Listing-related tables (all join on `listing_id` → `listings.id`)

| Table                           | Key columns                                                                                                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listings_address`              | `street`, `city`, `zip`, `latitude`, `longitude`, `coordinates` (POINT), `city_id` → `cities.id`, `region_id`                                                                                                                 |
| `listings_details`              | `bathrooms`, `half_bathrooms`, `bedrooms`, `pet_friendly`, `lot_size`, `unit` → `units.id`, `unidad_size`, `unidad_unit` → `units.id`, `construction_year`, `levels`, `flooring`, `cooling`, `parking_spaces`, `parking_type` |
| `listings_pricing`              | `price` (DECIMAL 12,2), `pricing_type_id` → `listings_price_type.id`                                                                                                                                                          |
| `listings_pricing_history`      | `price`, `date` — historical price changes                                                                                                                                                                                    |
| `listings_images`               | `image` (URL), `order`                                                                                                                                                                                                        |
| `listings_recreation_amenities` | Booleans: `gym`, `community_pool`, `elevator`, `security_cameras`, `controlled_access`, etc.                                                                                                                                  |
| `listings_unit_amenities`       | Booleans: `air_conditioning`, `cisterna`, `generator`, `private_pool`, `furnished`, `balcony`, `terrace`, etc.                                                                                                                |
| `listings_utilities`            | Booleans: `water`, `electricity`, `trash`, `gas`, `internet`, `tv`, `mantenimiento`                                                                                                                                           |
| `listing_history`               | `action` → `listings_status.id`, `price`, `action_date` — status change log                                                                                                                                                   |
| `listings_extra_contacts`       | Additional contacts assigned to a listing (`user_id`, `admin`, `assigned_by`)                                                                                                                                                 |
| `listings_metadata_history`     | JSON metadata snapshots with timestamps                                                                                                                                                                                       |
| `sponsored_listings`            | `plan_id` → `sponsored_listings_plans.id`, `stripe_id`, date range                                                                                                                                                            |

### Agents & Offices (MLS-sourced)

- `mls_agents`: Keyed by `id` (auto-increment PK). Unique on **(`mls`, `mls_agent_id`)**. Has `mls_office_id`, `email`, `first_name`, `last_name`, `phone`, `license`, `slug`.
- `mls_offices`: Keyed by `id`. Unique on **(`mls`, `mls_office_id`)**. Has `name`, `address`, `office_email`, `phone`, `website`.
- `mls_sync`: Links a Findit `users.id` to an `mls_agents.id` — used when an MLS agent also has a Findit account. Unique on (`mls_id`, `mls_user_id`, `user_id`).

**Always filter/join on both the ID column AND the `mls` column** to avoid cross-MLS collisions.

### Users

The `users` table holds people who signed up on finditpr.com.

| Column                            | Meaning                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| `first_name`, `last_name`, `name` | Name fields (`name` is a computed/concat field)                           |
| `email`                           | Unique                                                                    |
| `phone`                           | Unique, nullable                                                          |
| `agente`                          | Boolean — whether user identified as an agent                             |
| `user_type_id` → `users_type.id`  | 1 = AGENT, 2 = PROFESSIONAL, 3 = BUYER, 4 = FSBO, NULL = not yet selected |
| `created_at`                      | Registration date                                                         |
| `confirmed_email`                 | Boolean                                                                   |
| `banned`                          | Boolean                                                                   |

### Saved Searches

Use the `saved_searches` table: `user_id`, `name`, `url`, `query` (JSON — the Elasticsearch percolator query), `timestamp`, `removed_timestamp`, `sold` (boolean — whether it tracks sold properties).

**Ignore `users_saved_searches`** — it is deprecated.

### Geography

- `cities`: `id`, `name`, `city_shape` (polygon), `geojson`, `bounds`.
- `barrios`: `id`, `barrio`, `city_id` → `cities.id`. Barrios contain `sectores`.
- `sectores`: `id`, `sector`, `barrio_id`, `city_id`.
- `zips`: `id` (the actual zip code), `city_id`.
- `regions`: `id`, `name`.
- `parcel`: `catastro`, `parcela`, `parcela_procedencia`, `city_id`, `polygon`.

### Other notable tables

- `contact_via_findit`: Lead capture — someone contacted a landlord about a listing.
- `service_providers`: Directory businesses. `user_id` → `users.id`, `category_id` → `ads_categories.id`.
- `directory_ads`: Stripe-backed ads for service providers.

---

## Amplia MLS (`amplia-prod`)

Built on the [RESO Data Dictionary](https://ddwiki.reso.org/display/DDW20) standard. Core RESO tables: `Property`, `Member`, `Office`.

### Property

Primary keys: composite `(ListingId, ListingKey)`, but `ListingKey` is the main join key used everywhere.

| Column                                                    | Meaning                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ListingId`                                               | Human-readable listing ID (unique)                                                               |
| `ListingKey`                                              | System-generated UUID-style key (unique, used as FK everywhere)                                  |
| `ListAgentKey` → `Member.MemberKey`                       | Listing agent                                                                                    |
| `ListOfficeKey`                                           | Office key (references `Office.OfficeKey`)                                                       |
| `OriginatingSystemNameId` → `AMPLIA_OriginatingSystem.Id` | Source system. `NULL` = native Amplia listing. Non-null = external feed (e.g., Keller Williams). |

### Property data groups (star-schema, all join on `ListingKey`)

| Group table            | Key columns                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LocationGroup`        | `CityId` → `Cities.Id`, `PostalCodeId` → `PostalCode.Id`, `StreetName`, `StreetNumber`, `StreetSuffix`, `UnitNumber`, `Coordinates` (POINT)                                                                                                                                                                                              |
| `PriceGroup`           | `ListPrice`, `ClosePrice`, `OriginalListPrice`, `PreviousListPrice`, `ListPriceLow`                                                                                                                                                                                                                                                      |
| `DatesGroup`           | `ModificationTimestamp` (UTC), `OriginalEntryTimestamp`, `ActivationDate`, `ExpirationDate`, `CloseDate`, `ListingContractDate`, `OnMarketDate`, `OffMarketDate`, `StatusChangeTimestamp`, `DaysOnMarket`, `CumulativeDaysOnMarket`, `PriceChangeTimestamp`, `PendingTimestamp`, `WithdrawnDate`, `CancellationDate`, `BackOnMarketDate` |
| `StructureGroup`       | `BedroomsTotal`, `BedroomsPossible`, `BathroomsFull`, `BathroomsHalf`, `BathroomsTotalInteger`, `LivingArea`, `BuildingAreaTotal`, `LeasableArea`, `Stories`, `StoriesTotal`, `YearBuilt`, `ParkingTotal`, `GarageSpaces`, `OpenParkingSpaces`, `NewConstructionYN`, `BuildingName`                                                      |
| `CharacteristicsGroup` | `LotSizeArea`, `LotSizeAcres`, `LotSizeSquareFeet`, `LotSizeDimensions`, `NumberOfUnitsTotal`, `NumberOfBuildings`, `PoolPrivateYN`, `WaterfrontYN`, `ViewYN`, `SeniorCommunityYN`                                                                                                                                                       |
| `TaxGroup`             | `ParcelNumber`, `TaxAnnualAmount`, `Zoning`                                                                                                                                                                                                                                                                                              |
| `FinancialGroup`       | `CapRate`, `GrossIncome`, `NetOperatingIncome`, `TotalActualRent`, `NumberOfUnitsLeased`, `NumberOfUnitsVacant`, various expenses                                                                                                                                                                                                        |
| `HOAGroup`             | `AssociationFee`, `AssociationName`, `AssociationPhone`, `AssociationYN`                                                                                                                                                                                                                                                                 |
| `CompensationGroup`    | `BuyerBrokerageCompensation`, `CompensationComments`                                                                                                                                                                                                                                                                                     |
| `ClosingGroup`         | `AvailabilityDate`                                                                                                                                                                                                                                                                                                                       |
| `FarmingGroup`         | `CropsIncludedYN`, `CultivatedArea`                                                                                                                                                                                                                                                                                                      |
| `MarketingGroup`       | `VirtualTourURLBranded`, `VirtualTourURLUnbranded`                                                                                                                                                                                                                                                                                       |
| `MediaGroup`           | `PhotosChangeTimestamp`, `VideosChangeTimestamp`                                                                                                                                                                                                                                                                                         |
| `RemarksGroup`         | `PublicRemarks`, `PrivateRemarks`, `PrivateOfficeRemarks`, `SyndicationRemarks`                                                                                                                                                                                                                                                          |
| `UtilitiesGroup`       | `ElectricOnPropertyYN`, `NumberOfSeparateElectricMeters`, etc.                                                                                                                                                                                                                                                                           |
| `ContractGroup`        | `Exclusions`, `Inclusions`                                                                                                                                                                                                                                                                                                               |

**Total bathrooms formula:**

```sql
CAST(
  CASE
    WHEN sg.BathroomsFull IS NULL AND sg.BathroomsHalf IS NULL THEN NULL
    WHEN sg.BathroomsFull IS NULL THEN sg.BathroomsHalf
    WHEN sg.BathroomsHalf IS NULL THEN sg.BathroomsFull
    ELSE sg.BathroomsFull + sg.BathroomsHalf
  END AS UNSIGNED
) AS BathroomsTotalInteger
```

(Note: `StructureGroup.BathroomsTotalInteger` also exists as a stored column but may not always be populated.)

**Timestamps in Amplia are UTC.** Convert to AST for display:

```sql
CONVERT_TZ(dg.ModificationTimestamp, '+00:00', '-04:00')
```

### Property Features (the lookup pattern)

Features like StandardStatus, PropertyType, PropertySubType, LivingAreaUnits, SyndicateTo and LotSizeUnits are stored via a generic EAV (entity-attribute-value) lookup chain:

```
PropertyFeaturesTable (ListingKey, FeatureKey)  -- composite PK
  → FeatureKey  → Lookup.LookupKey
                   → Lookup.LookupNameId → LookupName.Id
```

- `LookupName.LookupName` identifies _what_ the feature is (e.g., `'StandardStatus'`, `'PropertyType'`, `'PropertySubType'`, `'LotSizeUnits'`, `'LivingAreaUnits'`).
- `Lookup.LookupValue` = English value (use for WHERE filtering).
- `Lookup.AMPLIA_ES_LookupValue` = Spanish display value.
- `Lookup.StandardLookupValue` = RESO standard value.

**To filter by a feature**, join a subquery per feature type:

```sql
LEFT JOIN (
  SELECT pft.ListingKey,
         l.AMPLIA_ES_LookupValue AS LookupValue,
         l.LookupValue AS LookupValue_EN
  FROM PropertyFeaturesTable pft
  JOIN Lookup l ON l.LookupKey = pft.FeatureKey
  JOIN LookupName ln ON ln.Id = l.LookupNameId
  WHERE ln.LookupName = '<FeatureName>'
  GROUP BY pft.ListingKey
) alias ON alias.ListingKey = p.ListingKey
```

### Key StandardStatus values (English — used for WHERE clauses)

| Status                               | Meaning                          |
| ------------------------------------ | -------------------------------- |
| `Active`                             | On market                        |
| `Active Under Contract`              | Under contract but still showing |
| `Coming Soon`                        | Pre-market                       |
| `Closed`                             | Sold/completed                   |
| `Incomplete`                         | Draft / not yet published        |
| `Withdrawn` / `Canceled` / `Expired` | Off market                       |

**Active inventory** = `LookupValue_EN IN ('Active', 'Active Under Contract', 'Coming Soon')`
**Draft inventory** = `LookupValue_EN IN ('Incomplete')`

### Sale vs. Rent detection

Check the Spanish `PropertyType` value — if it contains "Alquiler" it's a rental:

```sql
IF(pt.LookupValue LIKE '%Alquiler%', 'false', 'true') AS for_sale
```

### Key SyndicateTo values (English — used for WHERE clauses)

A property can have **multiple** SyndicateTo values (it's a multi-value feature). Use `GROUP_CONCAT` or check membership with a subquery.

| Value           | Meaning                         |
| --------------- | ------------------------------- |
| `finditpr.com`  | Syndicated to finditpr.com      |
| `Zillow/Trulia` | Syndicated to Zillow and Trulia |
| `Realtor.com`   | Syndicated to Realtor.com       |
| `ListHub`       | Syndicated to ListHub.com       |
| `Homes.com`     | Syndicated to Homes.com         |
| `Brevitas`      | Syndicated to Brevitas          |
| `Crexi`         | Syndicated to Crexi             |
| `IDX`           | Syndicated to IDX feed clients  |

**Syndicated to Findit** = `LookupValue_EN = 'finditpr.com'`
**Syndicated to any portal** = `LookupValue_EN IN ('finditpr.com', 'Zillow/Trulia', 'Realtor.com', 'ListHub', 'Homes.com', 'Brevitas', 'Crexi', 'IDX')`

### Member (Agents)

| Column                                                                    | Meaning                                  |
| ------------------------------------------------------------------------- | ---------------------------------------- |
| `MemberKey`                                                               | Primary key (UUID-style)                 |
| `MemberKeyNumeric`                                                        | Auto-increment numeric ID                |
| `MemberMlsId`                                                             | MLS ID string                            |
| `MemberFirstName`, `MemberLastName`, `MemberMiddleName`, `MemberNickname` | Name fields                              |
| `MemberEmail`, `MemberDirectPhone`                                        | Contact info                             |
| `MemberStateLicense`, `MemberStateLicenseExpirationDate`                  | License info                             |
| `MemberStatusLookupKey` → `Lookup.LookupKey`                              | Active/Inactive status                   |
| `MemberTypeLookupKey` → `Lookup.LookupKey`                                | Member type (Agent, Broker, etc.)        |
| `OfficeKey` → `Office.OfficeKey`                                          | The office this member belongs to        |
| `OriginatingSystemMemberKey`, `OriginatingSystemNameId`                   | For externally-synced members (e.g., KW) |

### Office

| Column                                                  | Meaning                                       |
| ------------------------------------------------------- | --------------------------------------------- |
| `OfficeKey`                                             | Primary key (UUID-style)                      |
| `OfficeKeyNumeric`                                      | Auto-increment numeric ID                     |
| `OfficeMlsId`                                           | MLS ID string                                 |
| `OfficeName`                                            | Office name                                   |
| `OfficeEmail`, `OfficePhone`                            | Contact                                       |
| `OfficeCorporateLicense`                                | Corporate license number                      |
| `OfficeBrokerKey` → `Member.MemberKey`                  | The broker/principal of this office           |
| `MainOfficeKey` → `Office.OfficeKey`                    | Parent office (self-referential for branches) |
| `OfficeStatusLookupKey` → `Lookup`                      | Active/Inactive                               |
| `OfficeBranchTypeLookupKey` → `Lookup`                  | Branch type                                   |
| `OriginatingSystemOfficeKey`, `OriginatingSystemNameId` | For externally-synced offices                 |

### Users & Organizations

- `user` table: Platform users. `user.memberKey` → `Member.MemberKey` links a user to their RESO Member record. Has `sandBox` (boolean — test users), `onboardCompleted`, `stripeCustomerId`.
- `organization` table: `organization.OfficeKey` → `Office.OfficeKey`. Has `name`, `slug`, `logo`.
- `organizationMember`: Links `userId` → `user.id` and `organizationId` → `organization.id` with a `role`.
- `invitation`: Org invitations with `email`, `role`, `status`, `expiresAt`.
- This structure allows data ingestion from partner systems (e.g., Keller Williams) without requiring direct signup.

### Other Amplia tables

- `rentspree`: `ListingKey` → `Property.ListingKey`. Holds `shortenLink` and `fullLink` for RentSpree rental application URLs.
- `Media`: Photos/videos. `ResourceRecordKey` = the ListingKey (or MemberKey/OfficeKey depending on `ResourceNameKey`). Has `MediaURL`, `Order`, `MediaTypeKey` and `MediaCategoryKey` (both → Lookup).
- `AMPLIA_ContactListings`: Lead capture for Amplia listings — `name`, `email`, `phone`, `message`, `ListingKey`.
- `AMPLIA_OriginatingSystem`: Registry of external feed sources (`Id`, `Name`).
- `AMPLIA_ExternalFeedError` / `AMPLIA_ExternalFeedErrorHistory`: Error tracking for external data feeds (e.g., KW sync issues).
- `AMPLIA_Filters` / `AMPLIA_LookupFilter`: Links Lookup values to named filter groups for UI filtering.
- `HistoryTransactional`: Audit log — tracks field-level changes on any resource. `ChangedByMemberKey`, `ChangeTypeLookupKey`, `FieldLookupKey`, `NewValue`, `PreviousValue`, `ResourceRecordKey`.
- `subscription`: Stripe subscription records (`plan`, `status`, `periodStart`, `periodEnd`, etc.).

### Filtering conventions

- `p.OriginatingSystemNameId IS NULL` — filters to Amplia-native listings (excludes syndicated/external-origin listings).
- `u.sandBox IS FALSE` — excludes test/sandbox agents.
- Always use `CONVERT_TZ(..., '+00:00', '-04:00')` when displaying timestamps to users (Puerto Rico = AST, no DST).

---

## Query Guidelines

1. **Always qualify agent/office joins in Findit with the `mls` column** to avoid cross-MLS ID collisions.
2. **Timestamps in Amplia are stored in UTC** — convert to AST (`-04:00`) for display.
3. **Use the lookup subquery pattern** (shown above) for any Amplia property feature — don't try to join `PropertyFeaturesTable` directly without the `LookupName` filter.
4. **GROUP BY ListingKey** in feature subqueries to handle potential multi-value features and avoid row duplication.
5. **Prefer LEFT JOIN** for all group tables in Amplia — not every listing has data in every group.
6. **Findit `listings.status`** is the column name (not `listing_status`) — it maps to `listings_status.id`.
7. **Findit pricing** lives in `listings_pricing.price`, not on the `listings` table itself.
8. **Findit address** lives in `listings_address`, not on the `listings` table itself.
