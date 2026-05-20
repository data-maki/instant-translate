# Blocked Tasks

## Google Places enrichment for POI-aware context terms
- **Status update (2026-05-19):** API credentials are present in environment as `GOOGLE_MAPS_SERVER_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY`.
- **Not blocked on missing key names anymore.** The next step is wiring backend calls that use `GOOGLE_MAPS_SERVER_KEY` against Places/Geocoding endpoints and then ranking/injecting returned POIs into context.
- **Why this still wasn't implemented yet:** The current code only captures GPS and manual hints; it does not yet perform server-side Google Places lookups or confidence/radius filtering.
