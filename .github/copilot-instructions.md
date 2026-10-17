# Project guide

## Architecture
- This is a small, static nautical map application; there is no framework or bundler.
- `navitools.py` only serves the current directory on port 8000 and opens a browser.
  It does not implement an API or store navigation data; the browser app persists
  navigation state in origin-specific local storage.
- `index.html` loads Leaflet 1.9.4 from unpkg before loading `app.js`.
- `app.js` owns the Leaflet map, toolbar handlers, navigation state and calculations;
  `style.css` controls the full-screen map, floating panels and point handles.
- OpenStreetMap supplies base tiles; OpenSeaMap supplies the seamark overlay.
  Both layers are added at startup. Leaflet assets and tiles require internet access.
- `app.js` also adds a Leaflet canvas graticule and layer switcher. OpenSeaMap
  compass-rose SVGs and geomagjs scripts are loaded in `index.html`; geomagjs
  calculates declination using pinned WMM2025 coefficients fetched from
  PyGeoMag's NOAA model data. The movable, resizable compass recalculates for the
  map location beneath its center when moved, resized, or when the map is panned.
  These online assets require internet access.

## Navigation tools
- Keep navigation data separate from Leaflet layers so points can be shared as the
  start of multiple directed lines. The toolbar has FIX and DR tools; do not
  reintroduce the retired LOS tool.
- FIX stays active for map placement and labels new fixes `FIX 1`, `FIX 2`, etc.
  FIX positions are authoritative and can be edited in the lower-left info panel
  or moved by dragging. Render a FIX as a small circle with a center dot.
- Enable DR only when a FIX or DR is selected. DR opens an inline popup for a true
  bearing from 0° through 360° and a positive distance in nautical miles. On OK,
  create a directed line from the selected point to a new derived point named
  `DR 1`, `DR 2`, etc. The new DR can start another leg. Render DRs as half-circles
  with center dots; they are selectable but cannot be moved or directly edited.
- Keep navigation marker roots absolutely positioned as required by Leaflet; use
  pseudo-elements for symbol artwork without overriding the marker's positioning,
  so the icon anchor, center dot, and line endpoint remain coincident.
- Show each point's label above its symbol and its live position below it in a
  small font, formatted as `N dd° mm.m' E ddd° mm.m'` with matching S/W
  hemispheres. Refresh map labels when points or their derived positions change,
  and escape user-provided labels before inserting them into marker HTML. While
  dragging a FIX, update route geometry without rebuilding point or line label
  icons; refresh those labels and the selected FIX info on `dragend`.
- Center each line's rounded, three-digit true-bearing label above the directed
  line and its one-decimal nautical-mile distance below it, at the projected line
  midpoint. Rotate both labels to follow the line while keeping text upright and
  preserving the above/below sides relative to the start-to-end direction.
- Store each line's start and end point, true bearing, and distance. Compute its
  DR endpoint with a great-circle destination calculation using a 6,371,000 m
  Earth radius and 1,852 m per nautical mile. Editing a FIX or a line recomputes
  downstream DRs and their lines; a FIX may branch into multiple DR legs. Each DR
  has exactly one defining inbound line.
- Selecting a FIX or DR shows its label and coordinates in the lower-left info
  panel; FIX coordinates and labels are editable, while DR coordinates are
  read-only. Display coordinates as `N dd° mm.mmm' - E ddd° mm.mmm'` (using the
  appropriate S/W hemispheres) and accept this same format when editing a FIX.
  Selecting a line shows editable bearing and distance. Confirm
  deletion and keep references valid; deleting a point/line with dependent DRs
  must clearly confirm the dependent cascade before removing those objects.
- Persist the navigation graph in versioned browser local storage after every
  completed FIX/DR/line mutation, including FIX drag end. Store point identity,
  type, label, coordinates, line references, bearing/distance, and numbering
  counters; rebuild Leaflet layers and recompute derived DR coordinates during
  startup restore. Clear removes the saved graph. Validate stored data before
  rebuilding it, preserve invalid or unwritable stored data, and display storage
  read/write failures to the user rather than silently discarding navigation data.
- Keep all visible UI text in English. Test FIX placement/editing/dragging, DR
  creation from FIX and DR, bearing/distance calculations, downstream propagation,
  validation, deletion/cancellation behavior, persistence across reloads, and
  storage failure reporting.

## Map overlay behavior
- Grid labels use hemisphere and padded degrees, with rounded whole minutes
  only when non-zero (for example, `N 30°`, `N 30° 12'`). Center labels over
  grid lines at the visible map's outer borders, use a translucent background,
  and redraw the graticule after map movement, zoom, or resize.

## Workflows and conventions
- Run `python navitools.py` from the project root: `index.html` lookup and static
  serving are relative to the working directory. Browse to `http://localhost:8000`.
- There is no package manifest, dependency installation step or build command.
- Run the JavaScript regression tests with `node --test app.test.js` (Node 18+).
  They execute `app.js` using lightweight DOM/Leaflet doubles, not a real browser.
- Browser-check FIX placement, dragging, DR popup entry, updated derived positions,
  selection, and clear behavior; unit tests do not validate Leaflet's actual
  pointer interactions or tile loading.
- Keep the existing plain-script structure, four-space indentation, double-quoted
  JavaScript strings and DOM IDs shared between `index.html` and `app.js`.
