# Nautical Navigation Tools

Nautical Navigation Tools is a browser-based map for plotting and managing
nautical fixes, routes, bearings, and celestial sights.

**[Open the live demo](https://barry-ballantines.github.io/navi-tools)**

## Using the map

The full-screen map includes OpenStreetMap tiles, an OpenSeaMap seamark overlay,
a coordinate grid, and a layer switcher. Use the toolbar to create navigation
objects, and select objects on the map to inspect or edit them in the information
panel. The compass rose can be moved and resized; it shows magnetic variation
for the location beneath its center.

### Navigation tools

- **FIX** — Select FIX, then click the map to place a named fix. Fixes can be
  moved by dragging or edited in the information panel.
- **DR** — Select a FIX or DR, then choose DR and enter a true bearing and
  distance in nautical miles. The resulting dead-reckoning point can start
  another DR leg.
- **GCR** — Select a FIX, choose GCR, then click the map to place the destination
  FIX. The app draws a great-circle route between the two fixes and updates it
  when either endpoint moves.
- **BRG TO** — Select a FIX and choose BRG TO to create a bearing line to it.
  Its endpoint can be dragged to change the line length while keeping the
  entered bearing.
- **INT** — Select a FIX and choose INT to plot a celestial intercept. Enter the
  star name, zenith bearing, and signed intercept distance: positive is
  **TOWARDS**, negative is **AWAY**. The map shows the sight and its line of
  position (LOP).

Select points or lines to view their details. FIX positions and labels, line
bearing and distance, and INT sight data can be edited in the information panel.
Use **Delete** to remove a selected object; dependent objects are confirmed
before a cascade deletion. **Clear** removes the navigation data from the map.

### Saving and sharing

Navigation data and the map's last center and zoom are saved in your browser's
local storage. This data is specific to the browser and site origin. Use
**IN/OUT** to view, download, or upload navigation JSON, and activate uploaded
data in the app. Clearing the map removes its saved navigation graph.

The map uses online map tiles and loads Leaflet and magnetic-variation assets
from external services, so an internet connection is needed for those features.

## Running locally

Python 3 is used only to serve the static files; no Python packages are needed.
From the project directory, run:

```powershell
python navitools.py
```

The server opens the site at <http://localhost:8000>. Run the command from the
project directory so it can find `index.html`.

## Tests

The JavaScript regression tests use Node.js 18 or later:

```powershell
node --test app.test.js
```
