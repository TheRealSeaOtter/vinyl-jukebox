VINYL JUKEBOX v0.5 — LIVE DATA + DISCOGS ARTWORK

WHAT CHANGED
- Shelf Library can now load live from the authoritative Google Sheet.
- Discogs exact Release ID is the primary artwork source.
- MusicBrainz + Cover Art Archive is fallback only.
- Discogs token stays server-side in Google Apps Script; it is never exposed in GitHub Pages.
- Resolved Discogs artwork is persistently cached by Release ID in Script Properties.
- Bundled records-data.js remains as an offline fallback.

ONE-TIME BACKEND SETUP
1. Open the Record Collection Database Google Sheet.
2. Extensions > Apps Script.
3. Replace the editor contents with Code.gs from this package, then Save.
4. In Apps Script: Project Settings > Script Properties > Add script property.
   Property: DISCOGS_TOKEN
   Value: your Discogs personal access token
   Save. Do NOT put the token in GitHub.
5. Deploy > New deployment > Select type: Web app.
   Execute as: Me
   Who has access: Anyone
   Deploy and authorize when Google asks.
6. Copy the Web app URL ending in /exec.

CONNECT THE LENOVO
1. Upload the normal web files to GitHub Pages. Code.gs does NOT need to be hosted by GitHub; it is just included here for setup.
2. Open the jukebox. On desktop, click the LIVE/OFFLINE status pill. On the Lenovo, open the app once on desktop OR temporarily use the browser desktop layout; paste the /exec URL in the connection dialog.
3. Tap SAVE & SYNC.

NOTE
The Apps Script URL is stored in localStorage per device. The Discogs token is stored only in Apps Script Script Properties.
