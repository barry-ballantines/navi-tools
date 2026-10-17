const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createApp() {
    const eventHandlers = {};
    const element = id => ({
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        style: {},
        hidden: false,
        disabled: false,
        tagName: id.toLowerCase().includes("bearing") ||
            id.toLowerCase().includes("distance") ||
            id.toLowerCase().includes("label") ||
            id.toLowerCase().includes("position")
            ? "INPUT"
            : "DIV",
        classList: { add() {}, remove() {} },
        addEventListener(event, handler) {
            eventHandlers[id + ":" + event] = handler;
        },
        focus() {}
    });
    const elements = Object.fromEntries(
        [
            "info", "infoMessage", "fixTool", "drTool", "clearTool",
            "pointInfo", "pointType", "pointLabel", "pointPosition",
            "lineInfo", "lineBearing", "lineDistance", "drPopup", "drForm",
            "drStartLabel", "drBearing", "drDistance", "drError", "drCancel",
            "magCompassRose", "magCompassTextTop", "magCompassTextBottom"
        ]
            .map(id => [id, element(id)])
    );
    elements.pointInfo.hidden = true;
    elements.lineInfo.hidden = true;
    elements.drPopup.hidden = true;
    elements.drTool.disabled = true;
    const layers = new Set();
    const markers = [];
    const lines = [];
    const handlers = {};
    const layerControl = {};
    const gridDrawOperations = [];
    const gridLabels = [];
    const gridLabelPositions = [];
    const gridBackgrounds = [];
    const gridState = {
        pixelBounds: {
            min: { x: 0, y: 0 },
            max: { x: 256, y: 256 }
        },
        font: "",
        fillStyle: "",
        textAlign: "",
        textBaseline: "",
        redraws: 0
    };
    const magneticLocations = [];
    const currentYear = new Date().getFullYear();
    const compassHandlers = {};
    const compassStyle = {};
    const compassClasses = new Set();
    const confirmations = [];
    let confirmResult = true;
    const compass = {
        style: compassStyle,
        get offsetWidth() {
            return parseFloat(compassStyle.width) || 240;
        },
        get offsetHeight() {
            return parseFloat(compassStyle.height) || 240;
        },
        classList: {
            add(className) { compassClasses.add(className); },
            remove(className) { compassClasses.delete(className); }
        },
        addEventListener(event, handler) {
            compassHandlers[event] = handler;
        },
        setPointerCapture() {},
        getBoundingClientRect() {
            return {
                left: parseFloat(compassStyle.left) || 100,
                top: parseFloat(compassStyle.top) || 100,
                width: parseFloat(compassStyle.width) || 240,
                height: parseFloat(compassStyle.height) || 240
            };
        }
    };
    let mapDraggingDisabled = false;
    const map = {
        setView() { return this; },
        on(event, handler) {
            handlers[event] = handlers[event] || [];
            handlers[event].push(handler);
        },
        removeLayer(layer) { layers.delete(layer); },
        getCenter() { return { lat: 54, lng: 10 }; },
        getPixelBounds() { return gridState.pixelBounds; },
        getContainer() {
            return {
                getBoundingClientRect: () => ({
                    left: 0, top: 0, width: 1000, height: 800
                })
            };
        },
        containerPointToLatLng(point) {
            return {
                lat: 54 + (point.y - 220) / 100,
                lng: 10 + (point.x - 220) / 100
            };
        },
        dragging: {
            disable() { mapDraggingDisabled = true; },
            enable() { mapDraggingDisabled = false; }
        },
        unproject(point) { return { lat: 85 - point.y / 256, lng: point.x / 256 }; },
        project(latlng) { return { x: latlng.lng * 256, y: (85 - latlng.lat) * 256 }; },
        latLngToLayerPoint(latlng) { return this.project(latlng); },
        layerPointToLatLng(point) {
            return { lat: 85 - point.y / 256, lng: point.x / 256 };
        }
    };
    class MockLayer {
        constructor() {
            this.events = {};
        }

        on(event, handler) {
            this.events[event] = handler;
            return this;
        }

        fire(event) {
            if (this.events[event]) {
                this.events[event]();
            }
        }

        addTo() {
            layers.add(this);
            return this;
        }

        setStyle(style) {
            this.style = style;
        }
    }
    class MockMarker extends MockLayer {
        constructor(latlng, options) {
            super();
            this.latlng = latlng;
            this.options = options;
            this.icon = options.icon;
            this.getLatLng = () => this.latlng;
            this.dragTo = position => {
                this.latlng = position;
                this.fire("drag");
            };
            markers.push(this);
        }

        setIcon(icon) {
            this.icon = icon;
        }

        setLatLng(latlng) {
            this.latlng = latlng;
            return this;
        }
    }
    class MockPolyline extends MockLayer {
        constructor(latlngs, options) {
            super();
            this.latlngs = latlngs;
            this.options = options;
            this.setLatLngs = positions => {
                this.latlngs = positions;
            };
            lines.push(this);
        }
    }
    class MockGridLayer extends MockLayer {
        constructor(options) {
            super();
            this.options = options;
        }

        getTileSize() {
            return { x: 256, y: 256 };
        }

        redraw() {
            gridState.redraws += 1;
            return this;
        }
    }
    const L = {
        Marker: MockMarker,
        GridLayer: {
            extend(definition) {
                return class extends MockGridLayer {
                    createTile(coords) {
                        return definition.createTile.call(this, coords);
                    }
                };
            }
        },
        map: () => map,
        tileLayer: () => ({
            addTo() {
                layers.add(this);
                return this;
            }
        }),
        control: {
            layers(baseLayers, overlays, options) {
                layerControl.baseLayers = baseLayers;
                layerControl.overlays = overlays;
                layerControl.options = options;
                return { addTo() {} };
            }
        },
        point: (x, y) => ({ x, y }),
        latLng: (lat, lng) => ({ lat, lng }),
        divIcon: options => options,
        marker: (latlng, options) => new MockMarker(latlng, options),
        polyline: (latlngs, options) => new MockPolyline(latlngs, options)
    };
    const sandboxContext = {
        L,
        document: {
            getElementById: id => id === "compassRose" ? compass : elements[id],
            querySelector: selector => selector === ".compass-rose" ? compass : null,
            querySelectorAll: () => Object.values(elements),
            addEventListener: (event, handler) => {
                eventHandlers["document:" + event] = handler;
            },
            createElement: tagName => {
                const element = {
                    tagName,
                    getContext: () => ({
                        set font(value) { gridState.font = value; },
                        set fillStyle(value) { gridState.fillStyle = value; },
                        set textAlign(value) { gridState.textAlign = value; },
                        set textBaseline(value) { gridState.textBaseline = value; },
                        beginPath() { gridDrawOperations.push("begin"); },
                        moveTo() { gridDrawOperations.push("move"); },
                        lineTo() { gridDrawOperations.push("line"); },
                        stroke() { gridDrawOperations.push("stroke"); },
                        measureText(text) { return { width: text.length * 5 }; },
                        fillRect(x, y, width, height) {
                            gridBackgrounds.push({
                                x, y, width, height, fillStyle: gridState.fillStyle
                            });
                        },
                        fillText(text, x, y) {
                            gridDrawOperations.push("label");
                            gridLabels.push(text);
                            gridLabelPositions.push({
                                text,
                                x,
                                y,
                                textAlign: gridState.textAlign,
                                textBaseline: gridState.textBaseline,
                                fillStyle: gridState.fillStyle
                            });
                        }
                    })
                };
                return element;
            }
        },
        fetch: () => Promise.resolve({
            ok: true,
            text: () => Promise.resolve("WMM2025")
        }),
        cof2Obj: text => text,
        geoMagFactory: () => (lat, lng, altitude, date) => {
            magneticLocations.push({ lat, lng });
            return { dec: 5 + (date.getFullYear() - currentYear) * 0.1 };
        },
        console: { error() {} }
        ,
        window: {
            confirm(message) {
                confirmations.push(message);
                return confirmResult;
            }
        }
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "app.js"), "utf8"),
        sandboxContext
    );
    return {
        elements,
        get markers() {
            return markers.filter(marker =>
                Object.hasOwn(marker.options, "draggable")
            );
        },
        get annotations() {
            return markers.filter(marker => marker.options.interactive === false);
        },
        lines, layers, layerControl, gridDrawOperations,
        gridLabels, gridLabelPositions, gridBackgrounds,
        gridFont: () => gridState.font,
        gridRedraws: () => gridState.redraws,
        compass, compassStyle, magneticLocations,
        compassClasses,
        mapDraggingDisabled: () => mapDraggingDisabled,
        ready: () => vm.runInNewContext("magneticVariationUpdate", sandboxContext),
        grid: () => vm.runInNewContext("coordinateGrid", sandboxContext),
        elements,
        confirmations,
        setConfirmResult: result => {
            confirmResult = result;
        },
        fireMapEvent: event => handlers[event].forEach(handler => handler()),
        setGridPixelBounds: pixelBounds => {
            gridState.pixelBounds = pixelBounds;
        },
        formatGridCoordinate: (value, isLatitude) =>
            vm.runInNewContext(
                `formatGridCoordinate(${value}, ${isLatitude})`,
                sandboxContext
            ),
        click: (lat, lng) =>
            handlers.click.forEach(handler =>
                handler({ latlng: { lat, lng } })
            ),
        select: id => elements[id].onclick(),
        submit: id => eventHandlers[id + ":submit"]({
            preventDefault() {}
        }),
        text: () => elements.infoMessage.textContent,
        deleteKey: (key = "Delete", target = { tagName: "BODY" }) =>
            eventHandlers["document:keydown"]({
                key,
                target,
                preventDefault() {},
                defaultPrevented: false
            }),
        dragCompass: async () => {
            compassHandlers.pointerdown({
                button: 0,
                pointerType: "mouse",
                pointerId: 1,
                clientX: 120,
                clientY: 120,
                target: { closest: () => null },
                preventDefault() {}
            });
            compassHandlers.pointermove({
                pointerId: 1,
                clientX: 220,
                clientY: 320
            });
            compassHandlers.pointerup({ pointerId: 1 });
            await vm.runInNewContext("magneticVariationUpdate", sandboxContext);
        },
        resizeCompass: async () => {
            compassHandlers.pointerdown({
                button: 0,
                pointerType: "mouse",
                pointerId: 2,
                clientX: 340,
                clientY: 340,
                target: {
                    closest: selector =>
                        selector === ".compass-resize" ? {} : null
                },
                preventDefault() {}
            });
            compassHandlers.pointermove({
                pointerId: 2,
                clientX: 440,
                clientY: 440
            });
            compassHandlers.pointerup({ pointerId: 2 });
            await vm.runInNewContext("magneticVariationUpdate", sandboxContext);
        }
    };
}

test("FIX tool places named, draggable FIX points only while active", () => {
    const app = createApp();
    app.click(0, 0);
    assert.equal(app.markers.length, 0);
    app.select("fixTool");
    app.click(0, 0);
    app.click(1, 2);

    assert.equal(app.markers.length, 2);
    assert.equal(app.markers[0].options.draggable, true);
    assert.equal(app.markers[0].icon.className, "navigation-point navigation-point-fix");
    assert.equal(app.markers[1].options.alt, "FIX 2");
    assert.equal(
        app.markers[1].icon.html,
        '<span class="navigation-point-label">FIX 2</span>' +
            '<span class="navigation-point-position">N 01° 00.0\' E 002° 00.0\'</span>'
    );
    assert.equal(app.lines.length, 0);
    assert.equal(app.text(), "");
    assert.equal(app.elements.pointLabel.value, "FIX 2");
});

test("DR is enabled for a selected point and creates a named DR leg", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    assert.equal(app.elements.drTool.disabled, false);

    app.select("drTool");
    assert.equal(app.elements.drPopup.hidden, false);
    assert.equal(app.elements.drStartLabel.textContent, "FIX 1");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60.04";
    app.submit("drForm");

    assert.equal(app.elements.drPopup.hidden, true);
    assert.equal(app.markers.length, 2);
    assert.equal(app.markers[1].options.draggable, false);
    assert.equal(app.markers[1].options.alt, "DR 1");
    assert.equal(app.markers[1].icon.className, "navigation-point navigation-point-dr navigation-point-selected");
    assert.equal(app.lines.length, 1);
    assert.equal(app.lines[0].latlngs[0].lat, 0);
    assert.ok(Math.abs(app.lines[0].latlngs[1].lng - 1) < 0.001);
    assert.equal(app.elements.pointLabel.value, "DR 1");
    assert.equal(app.elements.drTool.disabled, false);
});

test("DR leg creation rejects invalid bearing or non-positive distance", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "361";
    app.elements.drDistance.value = "10";
    app.submit("drForm");

    assert.equal(app.elements.drPopup.hidden, false);
    assert.match(app.elements.drError.textContent, /bearing/);
    assert.equal(app.lines.length, 0);

    app.elements.drBearing.value = "";
    app.elements.drDistance.value = "10";
    app.submit("drForm");
    assert.equal(app.lines.length, 0);

    app.elements.drBearing.value = "0";
    app.elements.drDistance.value = "0";
    app.submit("drForm");
    assert.equal(app.lines.length, 0);
});

test("DR line annotations show centered bearing and distance labels", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "12";
    app.elements.drDistance.value = "2.56";
    app.submit("drForm");

    const annotation = app.annotations[0];
    assert.equal(annotation.options.interactive, false);
    assert.equal(annotation.latlng.lng, app.lines[0].latlngs[1].lng / 2);
    assert.match(annotation.icon.html, /line-annotation-bearing">012°/);
    assert.match(annotation.icon.html, /line-annotation-distance">2\.6 nm/);
    assert.match(annotation.icon.html, /rotate\(-\d+\.\d{2}deg\)/);
    assert.equal(app.layers.has(annotation), true);
});

test("DR annotations update after leg edits and keep labels upright westbound", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "2";
    app.submit("drForm");
    const annotation = app.annotations[0];

    app.lines[0].fire("click");
    app.elements.lineBearing.value = "270";
    app.elements.lineDistance.value = "4.25";
    app.submit("lineInfo");

    assert.match(annotation.icon.html, /line-annotation-bearing">270°/);
    assert.match(annotation.icon.html, /line-annotation-distance">4\.3 nm/);
    assert.match(annotation.icon.html, /line-annotation-flipped/);
    assert.equal(
        annotation.latlng.lng,
        (app.lines[0].latlngs[0].lng + app.lines[0].latlngs[1].lng) / 2
    );
});

test("a DR can start another leg and FIX movement propagates through the course", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    app.select("drTool");
    app.elements.drBearing.value = "0";
    app.elements.drDistance.value = "60";
    app.submit("drForm");

    assert.equal(app.markers.length, 3);
    assert.equal(app.lines.length, 2);
    app.markers[0].dragTo({ lat: 10, lng: 20 });

    assert.ok(Math.abs(app.markers[1].getLatLng().lat - 10) < 0.003);
    assert.ok(Math.abs(app.markers[2].getLatLng().lat - 11) < 0.003);
    assert.ok(Math.abs(app.lines[0].latlngs[0].lng - 20) < 0.001);
    assert.equal(app.lines[1].latlngs[0], app.markers[1].getLatLng());
});

test("a FIX can branch into multiple DR legs and coordinate edits update both", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");

    app.markers[0].fire("click");
    app.select("drTool");
    app.elements.drBearing.value = "0";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    assert.equal(app.lines.length, 2);

    app.markers[0].fire("click");
    app.elements.pointPosition.value = "N 10° 00.000' - E 020° 00.000'";
    app.submit("pointInfo");

    assert.ok(Math.abs(app.lines[0].latlngs[0].lat - 10) < 0.001);
    assert.ok(Math.abs(app.lines[1].latlngs[0].lng - 20) < 0.001);
    assert.ok(Math.abs(app.markers[1].getLatLng().lat - 10) < 0.003);
    assert.ok(Math.abs(app.markers[2].getLatLng().lat - 11) < 0.003);
});

test("point info formats coordinates as padded degrees and decimal minutes", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(-12.5, -3.25);

    assert.equal(
        app.elements.pointPosition.value,
        "S 12° 30.000' - W 003° 15.000'"
    );
});

test("FIX position edits parse formatted coordinates and reject invalid minutes", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.elements.pointPosition.value = "S 12° 30.500' - W 003° 15.250'";
    app.submit("pointInfo");

    assert.ok(Math.abs(app.markers[0].getLatLng().lat - (-12.5083333333)) < 0.000001);
    assert.ok(Math.abs(app.markers[0].getLatLng().lng - (-3.2541666667)) < 0.000001);

    app.elements.pointPosition.value = "N 90° 00.001' - E 010° 00.000'";
    app.submit("pointInfo");
    assert.equal(app.markers[0].getLatLng().lat, -12.508333333333333);
    assert.match(app.text(), /format N 54°/);
});

test("map point labels escape custom text and refresh coordinates after edits", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.elements.pointLabel.value = "<Waypoint>";
    app.elements.pointPosition.value = "N 10° 00.000' - E 020° 00.000'";
    app.submit("pointInfo");

    assert.match(app.markers[0].icon.html, /&lt;Waypoint&gt;/);
    assert.match(
        app.markers[0].icon.html,
        /N 10° 00\.0' E 020° 00\.0'/
    );
});

test("editing a DR leg recalculates its endpoint", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    app.lines[0].fire("click");
    app.elements.lineBearing.value = "0";
    app.elements.lineDistance.value = "60";
    app.submit("lineInfo");

    assert.ok(Math.abs(app.markers[1].getLatLng().lat - 1) < 0.001);
    assert.ok(Math.abs(app.markers[1].getLatLng().lng) < 0.001);
    assert.match(app.markers[1].icon.html, /N 01° 00\.0' E 000° 00\.0'/);
});

test("clear removes navigation objects but preserves map layers", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    app.select("clearTool");

    assert.equal(app.layers.size, 3);
    assert.equal(app.markers.length, 2);
    assert.equal(app.lines.length, 1);
    assert.equal(app.text(), "Cleared");
    assert.equal(app.elements.drTool.disabled, true);

    app.select("fixTool");
    app.click(1, 1);
    assert.equal(app.markers.length, 3);
    assert.equal(app.markers[2].options.alt, "FIX 1");
});

test("OpenSeaMap seamarks and the coordinate grid are enabled as overlays", () => {
    const app = createApp();
    assert.equal(app.layers.size, 3);
    assert.equal(app.layerControl.baseLayers.OpenStreetMap !== undefined, true);
    assert.equal(app.layerControl.overlays["Nautical Marks (OpenSeaMap)"] !== undefined, true);
    assert.equal(app.layerControl.overlays["Latitude/Longitude Grid"] !== undefined, true);
});

test("the coordinate grid renders canvas lines and coordinate labels", () => {
    const app = createApp();
    const tile = app.grid().createTile({ x: 0, y: 0, z: 6 });
    assert.equal(tile.tagName, "canvas");
    assert.equal(tile.width, 256);
    assert.equal(app.gridDrawOperations.filter(operation => operation === "stroke").length > 0, true);
    assert.equal(app.gridDrawOperations.filter(operation => operation === "label").length > 0, true);
    assert.equal(app.gridLabels.includes("E 000°"), true);
    assert.equal(app.gridLabels.includes("N 84°"), true);
    assert.equal(app.gridFont(), "9px Arial, sans-serif");
    assert.equal(
        app.gridBackgrounds.every(background =>
            background.fillStyle === "rgba(255, 255, 255, 0.78)"
        ),
        true
    );
    assert.equal(
        app.gridLabelPositions.every(label =>
            label.textAlign === "center" &&
            label.textBaseline === "middle" &&
            label.fillStyle === "rgba(18, 56, 70, 0.95)"
        ),
        true
    );
    assert.equal(
        app.gridLabelPositions.find(label => label.text === "E 000°").x,
        0
    );
    assert.equal(
        app.gridLabelPositions.find(label => label.text === "N 84°").y,
        256
    );
});

test("grid labels use padded degrees and rounded whole minutes", () => {
    const app = createApp();
    assert.equal(app.formatGridCoordinate(30, true), "N 30°");
    assert.equal(app.formatGridCoordinate(30.2, true), "N 30° 12'");
    assert.equal(app.formatGridCoordinate(-12.25, true), "S 12° 15'");
    assert.equal(app.formatGridCoordinate(10.2666666667, false), "E 010° 16'");
    assert.equal(app.formatGridCoordinate(-3.999999, false), "W 004°");
});

test("grid labels only appear where grid lines meet the viewport border", () => {
    const app = createApp();
    app.setGridPixelBounds({
        min: { x: 0, y: 0 },
        max: { x: 3072, y: 768 }
    });

    app.grid().createTile({ x: 1, y: 1, z: 6 });
    assert.equal(app.gridLabelPositions.length, 0);

    app.grid().createTile({ x: 3, y: 0, z: 6 });
    assert.equal(app.gridLabelPositions.some(label => label.y === 8), true);

    app.grid().createTile({ x: 3, y: 2, z: 6 });
    assert.equal(app.gridLabelPositions.some(label => label.y === 248), true);

    app.grid().createTile({ x: 0, y: 1, z: 6 });
    assert.equal(app.gridLabelPositions.some(label => label.x === 20), true);

    app.grid().createTile({ x: 11, y: 1, z: 6 });
    assert.equal(app.gridLabelPositions.some(label => label.x === 236), true);
});

test("the coordinate grid refreshes its edge labels after movement and resize", () => {
    const app = createApp();
    app.grid().createTile({ x: 0, y: 0, z: 6 });
    const originalLabelCount = app.gridLabelPositions.length;
    const initialTopLabel = app.gridLabelPositions[0];

    app.setGridPixelBounds({
        min: { x: 20, y: 20 },
        max: { x: 300, y: 300 }
    });
    app.fireMapEvent("moveend");
    assert.equal(app.gridRedraws(), 1);
    app.grid().createTile({ x: 0, y: 0, z: 6 });
    assert.equal(app.gridLabelPositions.length > originalLabelCount, true);
    assert.notEqual(
        app.gridLabelPositions[originalLabelCount].y,
        initialTopLabel.y
    );

    app.setGridPixelBounds({
        min: { x: 20, y: 20 },
        max: { x: 300, y: 220 }
    });
    app.fireMapEvent("resize");
    assert.equal(app.gridRedraws(), 2);

    app.fireMapEvent("zoomend");
    assert.equal(app.gridRedraws(), 3);
});

test("the compass shows WMM2025 magnetic variation and annual change", async () => {
    const app = createApp();
    await app.ready();
    assert.equal(
        app.elements.magCompassTextTop.textContent,
        "VAR 5.0°E (" + new Date().getFullYear() + ")"
    );
    assert.equal(app.elements.magCompassTextBottom.textContent, "ANNUAL INCREASE 6'");
    assert.equal(app.elements.magCompassRose.style.transform, "rotate(5.0deg)");
});

test("dragging the compass recalculates variation at its new center location", async () => {
    const app = createApp();
    await app.ready();
    assert.deepEqual(app.magneticLocations[0], { lat: 54, lng: 10 });

    await app.dragCompass();

    assert.equal(app.compassStyle.left, "200px");
    assert.equal(app.compassStyle.top, "300px");
    assert.equal(app.mapDraggingDisabled(), false);
    assert.deepEqual(app.magneticLocations.at(-1), { lat: 56, lng: 11 });
});

test("resizing the compass updates its size and variation at the resized center", async () => {
    const app = createApp();
    await app.ready();
    assert.deepEqual(app.magneticLocations[0], { lat: 54, lng: 10 });

    await app.resizeCompass();

    assert.equal(app.compassStyle.width, "340px");
    assert.equal(app.compassStyle.height, "340px");
    assert.equal(app.mapDraggingDisabled(), false);
    assert.equal(app.compassClasses.has("resizing"), false);
    assert.deepEqual(app.magneticLocations.at(-1), { lat: 54.5, lng: 10.5 });
});

test("deleting a selected DR removes its defining line and confirms", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    const annotation = app.annotations[0];
    app.deleteKey();

    assert.equal(app.confirmations.length, 1);
    assert.equal(app.layers.has(app.markers[0]), true);
    assert.equal(app.layers.has(app.markers[1]), false);
    assert.equal(app.layers.has(app.lines[0]), false);
    assert.equal(app.layers.has(annotation), false);
    assert.equal(app.text(), "Object and dependent DRs deleted");
});

test("deleting a FIX cascades through dependent DRs and lines", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    app.select("drTool");
    app.elements.drBearing.value = "0";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    app.markers[0].fire("click");
    app.deleteKey();

    assert.match(app.confirmations[0], /dependent DR point/);
    assert.equal(app.layers.has(app.markers[0]), false);
    assert.equal(app.layers.has(app.markers[1]), false);
    assert.equal(app.layers.has(app.markers[2]), false);
    assert.equal(app.layers.has(app.lines[0]), false);
    assert.equal(app.layers.has(app.lines[1]), false);
});

test("cancelling deletion keeps the selected navigation graph", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");
    app.setConfirmResult(false);
    app.deleteKey();

    assert.equal(app.layers.has(app.markers[0]), true);
    assert.equal(app.layers.has(app.markers[1]), true);
    assert.equal(app.layers.has(app.lines[0]), true);
});

test("Delete ignores editable controls and other keys", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.deleteKey("Backspace");
    app.deleteKey("Delete", { tagName: "INPUT" });

    assert.equal(app.layers.has(app.markers[0]), true);
    assert.equal(app.confirmations.length, 0);
});
