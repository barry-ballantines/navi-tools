# Project guide

## Architecture
- This is a small, static nautical map application; there is no framework or bundler.
- `navitools.py` only serves the current directory on port 8000 and opens a browser.
  It does not implement an API or store measurements.
- `index.html` loads Leaflet 1.9.4 from unpkg before loading `app.js`.
- `app.js` owns the Leaflet map, toolbar handlers, measurement state and calculations;
  `style.css` controls the full-screen map, floating panels and point handles.
- OpenStreetMap supplies base tiles; OpenSeaMap supplies the seamark overlay.
  Both layers are added at startup. Leaflet assets and tiles require internet access.
- `app.js` also adds a Leaflet canvas graticule and layer switcher. OpenSeaMap
  compass-rose SVGs and geomagjs scripts are loaded in `index.html`; geomagjs
  calculates declination using pinned WMM2025 coefficients fetched from
  PyGeoMag's NOAA model data. The movable, resizable compass recalculates for the
  map location beneath its center when moved, resized, or when the map is panned.
  These online assets require internet access.

## Measurement behavior
- The LOS tool sets `mode` to `los`; two map clicks create a measurement.
  The active tool stays selected for subsequent pairs.
- `points` holds pending endpoint markers; `objects` tracks every measurement
  marker and polyline so the clear handler can remove them without removing tiles.
- Endpoints use draggable `L.marker` instances with an `L.divIcon` styled by
  `.measurement-point`; disable click bubbling to avoid creating extra points.
- Each completed pair stores its endpoint markers and line.
  Drag handlers read current marker coordinates and update only that pair's line.
  The shared info panel displays the measurement most recently created or dragged.
- Click a marker or LOS to select it; Delete removes the selected object.
  Deleting a marker also removes its connected LOS and reuses the other endpoint
  as the first point for a new LOS; deleting an LOS leaves both markers available
  for individual deletion.
- Each LOS measurement displays both `distanceNM` (haversine with a 6,371,000 m
  radius and 1,852 m per nautical mile) and `bearing` (initial bearing normalized
  to [0, 360)). Keep all visible UI text in English. Display nautical-mile
  distances with `nm` and two decimals; bearings use one decimal and a degree
  symbol.
- Grid coordinates use `N dd° mm.mm'` / `S dd° mm.mm'` for latitude and
  `E ddd° mm.mm'` / `W ddd° mm.mm'` for longitude.

## Workflows and conventions
- Run `python navitools.py` from the project root: `index.html` lookup and static
  serving are relative to the working directory. Browse to `http://localhost:8000`.
- There is no package manifest, dependency installation step or build command.
- Run the JavaScript regression tests with `node --test app.test.js` (Node 18+).
  They execute `app.js` using lightweight DOM/Leaflet doubles, not a real browser.
- Browser-check map clicks, endpoint dragging, updated readouts and clear behavior;
  unit tests do not validate Leaflet's actual pointer interactions or tile loading.
- Keep the existing plain-script structure, four-space indentation, double-quoted
  JavaScript strings and DOM IDs shared between `index.html` and `app.js`.
