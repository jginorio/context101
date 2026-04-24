## Amplia MLS (`amplia-prod` & `amplia-staging`)


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


| Value            | Meaning                                    |
| ---------------- | ------------------------------------------ |
| `finditpr.com`   | Syndicated to finditpr.com                 |
| `Zillow/Trulia`  | Syndicated to Zillow and Trulia            |
| `Realtor.com`    | Syndicated to Realtor.com                  |
| `ListHub`        | Syndicated to ListHub.com                  |
| `Homes.com`      | Syndicated to Homes.com                    |
| `Brevitas`       | Syndicated to Brevitas                     |
| `Crexi`          | Syndicated to Crexi                        |
| `IDX`            | Syndicated to IDX feed clients             |


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
