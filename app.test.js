const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createApp() {
    const elements = Object.fromEntries(
        [
            "info", "losTool", "clearTool", "magCompassRose",
            "magCompassTextTop", "magCompassTextBottom"
        ]
            .map(id => [id, {
                innerHTML: "",
                textContent: "",
                style: {},
                classList: { add() {}, remove() {} }
            }])
    );
    const layers = new Set();
    const markers = [];
    const lines = [];
    const handlers = {};
    const documentHandlers = {};
    const layerControl = {};
    const gridDrawOperations = [];
    const magneticLocations = [];
    const currentYear = new Date().getFullYear();
    const compassHandlers = {};
    const compassStyle = {};
    const compassClasses = new Set();
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
        on(event, handler) { handlers[event] = handler; },
        removeLayer(layer) { layers.delete(layer); },
        getCenter() { return { lat: 54, lng: 10 }; },
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
        project(latlng) { return { x: latlng.lng * 256, y: (85 - latlng.lat) * 256 }; }
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
            createElement: tagName => ({
                tagName,
                getContext: () => ({
                    beginPath() { gridDrawOperations.push("begin"); },
                    moveTo() { gridDrawOperations.push("move"); },
                    lineTo() { gridDrawOperations.push("line"); },
                    stroke() { gridDrawOperations.push("stroke"); },
                    fillText() { gridDrawOperations.push("label"); }
                })
            }),
            addEventListener: (event, handler) => {
                documentHandlers[event] = handler;
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
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "app.js"), "utf8"),
        sandboxContext
    );
    return {
        elements, markers, lines, layers, layerControl, gridDrawOperations,
        compass, compassStyle, magneticLocations,
        compassClasses,
        mapDraggingDisabled: () => mapDraggingDisabled,
        ready: () => vm.runInNewContext("magneticVariationUpdate", sandboxContext),
        grid: () => vm.runInNewContext("coordinateGrid", sandboxContext),
        click: (lat, lng) => handlers.click({ latlng: { lat, lng } }),
        select: id => elements[id].onclick(),
        text: () => elements.info.innerHTML,
        deleteKey: (key = "Delete", target = { tagName: "BODY" }) =>
            documentHandlers.keydown({ key, target, preventDefault() {} }),
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

test("a pending LOS endpoint can move before its line is created", () => {
    const app = createApp();
    app.click(0, 0);
    assert.equal(app.markers.length, 0);
    app.select("losTool");
    app.click(0, 0);
    assert.equal(app.markers[0].options.draggable, true);
    assert.equal(app.markers[0].options.bubblingMouseEvents, false);
    assert.equal(app.markers[0].options.icon.iconSize.join(","), "24,24");
    app.markers[0].dragTo({ lat: 0, lng: 1 });
    app.click(0, 2);
    assert.equal(app.lines[0].latlngs[0].lng, 1);
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 60.04 sm<br>Kurs: 90.0°");
});

test("dragging either endpoint updates its line, distance, and bearing", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.click(0, 1);
    app.markers[1].dragTo({ lat: 0, lng: 2 });
    assert.equal(app.lines[0].latlngs[1].lng, 2);
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 120.08 sm<br>Kurs: 90.0°");
    app.markers[0].dragTo({ lat: 0, lng: 1 });
    assert.equal(app.lines[0].latlngs[0].lng, 1);
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 60.04 sm<br>Kurs: 90.0°");
    assert.equal(app.markers.length, 2);
});

test("dragging an older LOS measurement does not move a newer line", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.click(0, 1);
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 60.04 sm<br>Kurs: 90.0°");
    app.click(10, 10);
    app.click(11, 10);
    const newerLine = app.lines[1].latlngs;
    app.markers[1].dragTo({ lat: 1, lng: 0 });
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 60.04 sm<br>Kurs: 0.0°");
    assert.equal(app.lines[1].latlngs, newerLine);
    app.markers[3].dragTo({ lat: 10, lng: 11 });
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 59.13 sm<br>Kurs: 89.9°");
});

test("clear removes completed and pending points but preserves tile layers", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.click(0, 1);
    app.click(1, 1);
    app.select("clearTool");
    assert.equal(app.layers.size, 3);
    assert.equal(app.text(), "Gelöscht");
    app.click(2, 2);
    assert.equal(app.markers.length, 3);
    app.select("losTool");
    app.click(0, 0);
    assert.equal(app.lines.length, 1);
    app.click(0, 1);
    assert.equal(app.lines.length, 2);
});

test("OpenSeaMap seamarks and the coordinate grid are enabled as overlays", () => {
    const app = createApp();
    assert.equal(app.layers.size, 3);
    assert.equal(app.layerControl.baseLayers.OpenStreetMap !== undefined, true);
    assert.equal(app.layerControl.overlays["Seezeichen (OpenSeaMap)"] !== undefined, true);
    assert.equal(app.layerControl.overlays["Breiten-/Längengrad"] !== undefined, true);
});

test("the coordinate grid renders canvas lines and coordinate labels", () => {
    const app = createApp();
    const tile = app.grid().createTile({ x: 0, y: 0, z: 6 });
    assert.equal(tile.tagName, "canvas");
    assert.equal(tile.width, 256);
    assert.equal(app.gridDrawOperations.filter(operation => operation === "stroke").length > 0, true);
    assert.equal(app.gridDrawOperations.filter(operation => operation === "label").length > 0, true);
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

test("Delete removes a selected LOS but keeps its endpoint markers", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.click(0, 1);

    app.lines[0].fire("click");
    assert.equal(app.lines[0].style.color, "orange");
    assert.equal(app.lines[0].style.weight, 5);
    app.deleteKey();

    assert.equal(app.layers.has(app.lines[0]), false);
    assert.equal(app.layers.has(app.markers[0]), true);
    assert.equal(app.layers.has(app.markers[1]), true);
    assert.equal(app.text(), "Objekt gelöscht");
});

test("Delete on a marker removes it and its LOS but keeps the other endpoint", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.click(0, 1);

    app.markers[0].fire("click");
    assert.match(app.markers[0].icon.className, /measurement-point-selected/);
    app.deleteKey();

    assert.equal(app.layers.has(app.markers[0]), false);
    assert.equal(app.layers.has(app.lines[0]), false);
    assert.equal(app.layers.has(app.markers[1]), true);
    assert.equal(app.text(), "LOS aktiv<br>Weiteren Punkt setzen");
});

test("deleting a LOS endpoint keeps the other as the first point of a new LOS", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.click(0, 1);

    app.markers[0].fire("click");
    app.deleteKey();

    assert.equal(app.layers.has(app.markers[0]), false);
    assert.equal(app.layers.has(app.lines[0]), false);
    assert.equal(app.layers.has(app.markers[1]), true);
    assert.equal(app.text(), "LOS aktiv<br>Weiteren Punkt setzen");

    app.click(0, 2);

    assert.equal(app.lines.length, 2);
    assert.equal(app.lines[1].latlngs[0].lng, 1);
    assert.equal(app.lines[1].latlngs[1].lng, 2);
    assert.equal(app.layers.has(app.lines[1]), true);
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 60.04 sm<br>Kurs: 90.0°");
});

test("Delete removes a selected pending marker without completing a false pair", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.markers[0].fire("click");
    app.deleteKey();
    app.click(0, 1);

    assert.equal(app.lines.length, 0);
    assert.equal(app.layers.has(app.markers[0]), false);
    assert.equal(app.markers.length, 2);
});

test("Delete ignores editable controls and other keys", () => {
    const app = createApp();
    app.select("losTool");
    app.click(0, 0);
    app.markers[0].fire("click");
    app.deleteKey("Backspace");
    app.deleteKey("Delete", { tagName: "INPUT" });

    assert.equal(app.layers.has(app.markers[0]), true);
});
