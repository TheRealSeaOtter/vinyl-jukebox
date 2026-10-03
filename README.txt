VINYL JUKEBOX v0.4 — TABLET LAYOUT PASS

Changes from v0.3:
- Removes the large app header on coarse-pointer landscape devices (the Lenovo jukebox tablet).
- Reclaims vertical space on Home, Collection, Queue, and Stats.
- Raises/enlarges the Home artwork area and tightens selected-record typography.
- Demotes Up Next to a narrower, denser sidebar.
- Keeps bottom navigation and Pick Something behavior intact.
- Leaves the desktop layout intact.
- Updates the service-worker cache so GitHub Pages changes refresh correctly.

Prototype data and behavior remain the same as v0.3. No Google Sheet writes are performed.


v0.4 tablet pass: larger Now Playing art and slide-over Up Next quick queue.


v0.4 REAL COLLECTION
- 547 Shelf Library rows embedded from the authoritative Google Sheet snapshot exported 2026-10-02.
- Discogs Instance ID is the copy-level key.
- Real artist/title/year/label/format/folder/rating/genre/sub-genre metadata powers search, filters and random picks.
- Existing local queue/play history is preserved when IDs still exist.
- Artwork is resolved lazily to avoid hammering the remote artwork service.
- Sheet remains read-only; this build is a current snapshot, not live sync yet.


v0.4.1 ARTWORK RELIABILITY
- Clears only previously cached blank artwork failures; successful cached covers are preserved.
- Failed lookups are retryable instead of becoming permanent blanks.
- Uses two-stage album searches with normalized title/artist matching and a confidence score.
- No longer blindly accepts the first search result.
- Requests larger artwork and throttles remote searches with a two-worker queue.
- Discogs Release IDs remain in the data for a future authenticated exact-release artwork backend.
