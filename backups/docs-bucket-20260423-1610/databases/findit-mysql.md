# Metabase — Findit Database Context

## Findit (`find-it-prod`) - Findit Staging DB on Metabase is called "Findit Staging"

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
