VINYL JUKEBOX v0.3 — prototype

QUICK START
1. Unzip this folder.
2. Double-click index.html.
3. Chrome/Edge is recommended.

WHAT'S NEW
- Album detail modal with Play Now / Add to Queue.
- Editable queue: move up/down, remove, play.
- Collection search, sort, and filters based on the real Shelf Library schema.
- Pick From These for filtered crate-style random selection.
- Pick Something flow: Surprise Me, Genre/Style, Vibe, Dig Deeper.
- Surprise Me uses crypto.getRandomValues() for a true application-side random draw.
- Dig Deeper: Anything, Haven't Played Lately, Never Played, Old Favorite.
- Nah, Try Again rerolls inside the same candidate pool.
- Remote artwork lookup through Apple's public search endpoint, with graceful fallback to prototype covers.
- Local play/queue state remains in browser localStorage for this prototype.

DATA NOTE
The seven seed records mirror real fields/sample rows from the current Shelf Library. The live Google Sheet is NOT modified or connected for writes in v0.3.

NEXT MILESTONE
Connect the full Shelf Library and durable queue/play history through a thin Google-backed API, while keeping the existing collection sheet authoritative.
