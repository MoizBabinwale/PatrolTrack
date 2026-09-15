# PatrolTrack GIS — React + Tailwind

Frontend-only application for:

- Uploading a SQLite `.db` / `.sqlite` patrol backup.
- Extracting every SQLite table/view and displaying its rows.
- Detecting common latitude/longitude columns and turning them into patrol tracks.
- Uploading the original `Comptt_PTR.kml` or `Comptt_PTR.kmz`.
- Displaying compartments + patrol tracks together on a responsive Leaflet map.
- Exporting a merged KML and KMZ.
- Printing the extracted report page to PDF from the browser.

## Important limitation

The app is schema-agnostic. It automatically detects columns named `lat`, `latitude`, `longitude`, `lon`, `lng`, etc.

If your `patrol_backup.db` uses different column names or stores coordinates in JSON/text fields, update `findLikelyTrackColumns()` in `src/lib/db.js` and the track-building code in `src/App.jsx` for the exact schema.

## Install

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Build

```bash
npm run build
```

The project can then be deployed to Vercel/Netlify/static hosting.

## Usage

1. Upload `patrol_backup.db`.
2. Upload your original `Comptt_PTR(1).kmz`.
3. Open **Extracted Data** to inspect every table.
4. Open **Map & Tracks** to see the overlap.
5. Open **PTR Report** and use Print / Save PDF.
6. Download KML or KMZ from the top-right.

## Privacy

Database/KML processing happens in the browser. The SQLite database is loaded into sql.js in the user's browser. The map tile provider is contacted only to display map tiles.