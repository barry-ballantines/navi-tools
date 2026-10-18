const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function distanceInNM(first, second) {
    const radians = degrees => degrees * Math.PI / 180;
    const latitudeDifference = radians(second.lat - first.lat);
    const longitudeDifference = radians(second.lng - first.lng);
    const latitude1 = radians(first.lat);
    const latitude2 = radians(second.lat);
    const haversine =
        Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(latitude1) * Math.cos(latitude2) *
        Math.sin(longitudeDifference / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(haversine)) / 1852;
}

function createApp(options = {}) {
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
            "info", "infoMessage", "fixTool", "drTool", "gcrTool", "brgToTool", "intTool", "clearTool",
            "pointInfo", "pointType", "pointLabel", "pointPosition",
            "lineInfo", "lineTitle", "lineBearing", "lineDistance", "drPopup", "drForm",
            "interceptInfo", "interceptName", "interceptBearing", "interceptDistance",
            "drStartLabel", "drBearing", "drDistance", "drError", "drCancel",
            "brgToPopup", "brgToForm", "brgToFixLabel", "brgToBearing",
            "brgToError", "brgToCancel",
            "intPopup", "intForm", "intFixLabel", "intName", "intBearing",
            "intDistance", "intError", "intCancel",
            "magCompassRose", "magCompassTextTop", "magCompassTextBottom"
        ]
            .map(id => [id, element(id)])
    );
    elements.pointInfo.hidden = true;
    elements.lineInfo.hidden = true;
    elements.drPopup.hidden = true;
    elements.brgToPopup.hidden = true;
    elements.interceptInfo.hidden = true;
    elements.intPopup.hidden = true;
    elements.drTool.disabled = true;
    elements.gcrTool.disabled = true;
    elements.brgToTool.disabled = true;
    elements.intTool.disabled = true;
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
    const storageValues = options.storageValues || new Map();
    const storage = options.storage || {
        getItem(key) {
            if (options.failStorageRead) {
                throw new Error("storage read denied");
            }
            return storageValues.has(key) ? storageValues.get(key) : null;
        },
        setItem(key, value) {
            if (options.failStorageWrite) {
                throw new Error("storage write denied");
            }
            storageValues.set(key, value);
        },
        removeItem(key) {
            if (options.failStorageWrite) {
                throw new Error("storage write denied");
            }
            storageValues.delete(key);
        }
    };
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
    let mapCenter = { lat: 54, lng: 10 };
    let mapZoom = 6;
    const map = {
        setView(center, zoom) {
            mapCenter = Array.isArray(center)
                ? { lat: center[0], lng: center[1] }
                : center;
            mapZoom = zoom;
            return this;
        },
        on(event, handler) {
            handlers[event] = handlers[event] || [];
            handlers[event].push(handler);
        },
        removeLayer(layer) { layers.delete(layer); },
        getCenter() { return mapCenter; },
        getZoom() { return mapZoom; },
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
            this.endDrag = () => this.fire("dragend");
            this.iconHistory = [options.icon];
            markers.push(this);
        }

        setIcon(icon) {
            this.icon = icon;
            this.options.icon = icon;
            this.iconHistory.push(icon);
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
            },
            localStorage: storage
        }
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "app.js"), "utf8"),
        sandboxContext
    );
    return {
        elements,
        storage,
        storageValues,
        get markers() {
            return markers.filter(marker =>
                Object.hasOwn(marker.options, "draggable") &&
                Object.hasOwn(marker.options, "alt")
            );
        },
        get bearingHandles() {
            return markers.filter(marker =>
                marker.options.icon.className === "navigation-bearing-handle"
            );
        },
        get interceptHandles() {
            return markers.filter(marker =>
                ["intercept-arrow-handle", "intercept-lop-handle"]
                    .includes(marker.options.icon.className)
            );
        },
        get interceptStars() {
            return markers.filter(marker =>
                marker.options.icon.className === "intercept-star-icon"
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
        setViewport: (lat, lng, zoom) => {
            map.setView([lat, lng], zoom);
            handlers.moveend.forEach(handler => handler());
            handlers.zoomend.forEach(handler => handler());
        },
        viewport: () => ({ center: mapCenter, zoom: mapZoom }),
        formatGridCoordinate: (value, isLatitude, precision) =>
            vm.runInNewContext(
                `formatGridCoordinate(${value}, ${isLatitude}, ${precision})`,
                sandboxContext
            ),
        click: (lat, lng) =>
            handlers.click.forEach(handler =>
                handler({ latlng: { lat, lng } })
            ),
        endDrag: index =>
            markers.filter(marker =>
                Object.hasOwn(marker.options, "draggable")
            )[index].endDrag(),
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

test("BRG TO creates a dashed 5 nm line ending at the selected FIX", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    const fix = app.markers[0];

    assert.equal(app.elements.brgToTool.disabled, false);
    app.select("brgToTool");
    assert.equal(app.elements.brgToPopup.hidden, false);
    assert.equal(app.elements.brgToFixLabel.textContent, "FIX 1");
    app.elements.brgToBearing.value = "90";
    app.submit("brgToForm");

    const line = app.lines[0];
    assert.equal(app.elements.brgToPopup.hidden, true);
    assert.equal(line.options.color, "#555");
    assert.equal(line.options.dashArray, "6, 6");
    assert.ok(Math.abs(line.latlngs[0].lng + 5 / 60) < 0.001);
    assert.equal(line.latlngs[1], fix.getLatLng());
    assert.equal(app.bearingHandles.length, 1);
    assert.equal(app.bearingHandles[0].options.icon.iconSize[0] < 22, true);
    assert.equal(app.bearingHandles[0].options.zIndexOffset, 1000);
    assert.equal(app.elements.lineTitle.textContent, "BRG TO line");
    assert.equal(app.elements.lineBearing.value, 90);
    assert.equal(app.elements.lineDistance.value, 5);
    assert.match(app.annotations[0].icon.html, /line-annotation-bearing">090°/);
    assert.match(app.annotations[0].icon.html, /line-annotation-distance">5\.0 nm/);
});

test("BRG TO handle changes length on its fixed bearing and line edits recalculate it", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("brgToTool");
    app.elements.brgToBearing.value = "90";
    app.submit("brgToForm");

    const handle = app.bearingHandles[0];
    const originalStart = app.lines[0].latlngs[0];
    handle.dragTo({ lat: 0.05, lng: -0.1 });
    handle.endDrag();
    assert.ok(Math.abs(handle.getLatLng().lat) < 1e-10);
    assert.ok(handle.getLatLng().lng < originalStart.lng);
    assert.equal(app.lines[0].latlngs[0], handle.getLatLng());
    assert.equal(app.elements.lineDistance.value > 5, true);
    assert.equal(app.lines[0].latlngs[1], app.markers[0].getLatLng());

    app.lines[0].fire("click");
    app.elements.lineBearing.value = "180";
    app.elements.lineDistance.value = "10";
    app.submit("lineInfo");
    assert.ok(app.lines[0].latlngs[0].lat > 0);
    assert.equal(app.lines[0].latlngs[1], app.markers[0].getLatLng());
    assert.match(app.annotations[0].icon.html, /line-annotation-bearing">180°/);
    assert.match(app.annotations[0].icon.html, /line-annotation-distance">10\.0 nm/);
});

test("moving a FIX moves attached BRG TO geometry without changing its bearing or length", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("brgToTool");
    app.elements.brgToBearing.value = "90";
    app.submit("brgToForm");
    const line = app.lines[0];
    const handle = app.bearingHandles[0];
    const originalDistance = app.elements.lineDistance.value;

    app.markers[0].dragTo({ lat: 5, lng: 10 });
    assert.equal(line.latlngs[1], app.markers[0].getLatLng());
    assert.equal(handle.getLatLng(), line.latlngs[0]);
    assert.ok(Math.abs(handle.getLatLng().lat - 5) < 0.001);
    assert.equal(app.elements.lineDistance.value, originalDistance);
    app.endDrag(0);
    assert.match(app.annotations[0].icon.html, /line-annotation-bearing">090°/);
});

test("BRG TO persists, deletes independently, and is removed with its FIX", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(1, 2);
    app.select("brgToTool");
    app.elements.brgToBearing.value = "45";
    app.submit("brgToForm");

    const savedWithBearingLine = new Map(app.storageValues);
    const restored = createApp({ storageValues: app.storageValues });
    assert.equal(restored.markers.length, 1);
    assert.equal(restored.lines.length, 1);
    assert.equal(restored.bearingHandles.length, 1);
    assert.equal(restored.lines[0].options.dashArray, "6, 6");
    restored.lines[0].fire("click");
    restored.deleteKey();
    assert.equal(restored.markers.length, 1);
    assert.equal(restored.lines.length, 1);
    const afterLineDelete = createApp({ storageValues: restored.storageValues });
    assert.equal(afterLineDelete.markers.length, 1);
    assert.equal(afterLineDelete.lines.length, 0);

    const withBearingLine = createApp({ storageValues: savedWithBearingLine });
    withBearingLine.markers[0].fire("click");
    withBearingLine.deleteKey();
    assert.match(withBearingLine.confirmations[0], /attached BRG TO line/);
    const afterFixDelete = createApp({ storageValues: withBearingLine.storageValues });
    assert.equal(afterFixDelete.markers.length, 0);
    assert.equal(afterFixDelete.lines.length, 0);
});

test("BRG TO rejects invalid bearings", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("brgToTool");
    app.elements.brgToBearing.value = "361";
    app.submit("brgToForm");

    assert.equal(app.elements.brgToPopup.hidden, false);
    assert.match(app.elements.brgToError.textContent, /bearing/);
    assert.equal(app.lines.length, 0);
});

test("INT plots a positive intercept, star, arrow label, and perpendicular LOP", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    assert.equal(app.elements.intTool.disabled, false);
    app.select("intTool");
    assert.equal(app.elements.intPopup.hidden, false);
    assert.equal(app.elements.intFixLabel.textContent, "FIX 1");
    app.elements.intName.value = "Sirius";
    app.elements.intBearing.value = "25";
    app.elements.intDistance.value = "12.5";
    app.submit("intForm");

    assert.equal(app.elements.intPopup.hidden, true);
    assert.equal(app.elements.interceptInfo.hidden, false);
    assert.equal(app.elements.interceptName.value, "Sirius");
    assert.equal(app.elements.interceptBearing.value, 25);
    assert.equal(app.elements.interceptDistance.value, 12.5);
    assert.equal(app.lines.length, 2);
    assert.equal(app.lines[0].options.color, "#666");
    assert.equal(app.lines[0].options.dashArray, "6, 6");
    assert.equal(app.lines[1].options.dashArray, undefined);
    assert.equal(app.interceptStars.length, 1);
    assert.match(app.interceptStars[0].options.icon.html, /★/);
    assert.match(app.interceptStars[0].options.icon.html, /Sirius/);
    assert.equal(app.interceptStars[0].options.interactive, false);
    assert.equal(app.interceptStars[0].options.draggable, undefined);
    const arrowAnnotation = app.annotations.find(marker =>
        marker.options.icon.className === "intercept-line-annotation-icon"
    );
    assert.match(arrowAnnotation.options.icon.html, /025°/);
    assert.match(arrowAnnotation.options.icon.html, /12\.5 nm TOWARDS/);
    assert.equal(app.interceptHandles.length, 3);
    const lop = app.lines[1];
    assert.ok(Math.abs(distanceInNM(lop.latlngs[0], lop.latlngs[1]) - 2) < 0.001);
    const lopDeltaX = lop.latlngs[1].lng - lop.latlngs[0].lng;
    const lopDeltaY = lop.latlngs[1].lat - lop.latlngs[0].lat;
    const bearingRadians = 25 * Math.PI / 180;
    assert.ok(Math.abs(
        lopDeltaX * Math.sin(bearingRadians) +
        lopDeltaY * Math.cos(bearingRadians)
    ) < 0.000001);
    const lopLabels = app.annotations.filter(marker =>
        marker.options.icon.className === "intercept-lop-label-icon"
    );
    assert.equal(lopLabels.length, 1);
    const lopLabel = lopLabels[0];
    assert.match(lopLabel.options.icon.html, /LOP: Sirius/);
    assert.match(lopLabel.options.icon.html, /rotate\(/);
    assert.match(lopLabel.options.icon.html, /line-annotation-flipped/);
    const start = lop.latlngs[0];
    const end = lop.latlngs[1];
    const startScore = start.lng + (85 - start.lat);
    const endScore = end.lng + (85 - end.lat);
    const selectedEnd = startScore <= endScore ? start : end;
    const otherEnd = selectedEnd === start ? end : start;
    const expectedLabel = {
        lat: (3 * selectedEnd.lat + otherEnd.lat) / 4,
        lng: (3 * selectedEnd.lng + otherEnd.lng) / 4
    };
    assert.ok(Math.abs(lopLabel.latlng.lat - expectedLabel.lat) < 1e-8);
    assert.ok(Math.abs(lopLabel.latlng.lng - expectedLabel.lng) < 1e-8);

    const iconHistoryLength = lopLabel.iconHistory.length;
    app.fireMapEvent("zoomend");
    assert.equal(lopLabel.iconHistory.length, iconHistoryLength + 1);
});

test("INT AWAY adds an opposite dashed line, and any INT line opens editable sight data", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "Vega";
    app.elements.intBearing.value = "25";
    app.elements.intDistance.value = "-12.5";
    app.submit("intForm");

    assert.equal(app.lines.length, 3);
    assert.equal(app.lines[0].options.dashArray, "6, 6");
    assert.equal(app.lines[1].options.dashArray, "6, 6");
    assert.equal(app.lines[2].options.dashArray, undefined);
    assert.ok(app.lines[0].latlngs[1].lat > 0);
    assert.ok(app.lines[1].latlngs[1].lat < 0);
    const awayAnnotation = app.annotations.find(marker =>
        marker.options.icon.className === "intercept-line-annotation-icon"
    );
    assert.match(awayAnnotation.options.icon.html, /025°/);
    assert.match(awayAnnotation.options.icon.html, /12\.5 nm AWAY/);
    assert.match(app.interceptStars[0].options.icon.html, /Vega/);

    app.lines[2].fire("click");
    assert.equal(app.elements.interceptInfo.hidden, false);
    assert.equal(app.elements.interceptName.value, "Vega");
    assert.equal(app.elements.interceptDistance.value, -12.5);
    app.elements.interceptName.value = "Altair";
    app.elements.interceptBearing.value = "90";
    app.elements.interceptDistance.value = "8.25";
    app.submit("interceptInfo");

    assert.equal(app.lines.length, 3);
    assert.equal(app.layers.has(app.lines[1]), false);
    assert.match(app.interceptStars[0].options.icon.html, /Altair/);
    assert.ok(app.lines[0].latlngs[1].lng > 0);
    const towardsAnnotation = app.annotations.find(marker =>
        marker.options.icon.className === "intercept-line-annotation-icon"
    );
    assert.match(towardsAnnotation.options.icon.html, /090°/);
    assert.match(towardsAnnotation.options.icon.html, /8\.3 nm TOWARDS/);
    assert.equal(app.elements.interceptBearing.value, 90);
    assert.equal(app.elements.interceptDistance.value, 8.25);
});

test("INT arrow and LOP handles change only their own lengths", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "Rigel";
    app.elements.intBearing.value = "0";
    app.elements.intDistance.value = "10";
    app.submit("intForm");
    const originalArrowEnd = app.lines[0].latlngs[1];
    const originalLopStart = app.lines[1].latlngs[0];

    app.interceptHandles[0].dragTo({ lat: 0.3, lng: 0.1 });
    app.interceptHandles[0].endDrag();
    assert.ok(app.lines[0].latlngs[1].lat > originalArrowEnd.lat);
    assert.ok(Math.abs(app.lines[0].latlngs[1].lng) < 1e-8);
    assert.equal(app.lines[1].latlngs[0].lat, originalLopStart.lat);

    app.interceptHandles[1].dragTo({ lat: 0.2, lng: 0.2 });
    app.interceptHandles[1].endDrag();
    assert.ok(app.lines[1].latlngs[0].lng > originalLopStart.lng);
    assert.equal(app.lines[1].latlngs[1].lng < 0, true);
    const originalLopEnd = app.lines[1].latlngs[1];
    app.interceptHandles[2].dragTo({ lat: -0.2, lng: -0.1 });
    app.interceptHandles[2].endDrag();
    assert.ok(app.lines[1].latlngs[1].lng < originalLopEnd.lng);
    assert.match(app.annotations.find(marker =>
        marker.options.icon.className === "intercept-line-annotation-icon"
    ).options.icon.html, /10\.0 nm TOWARDS/);
});

test("INT metadata, adjustable geometry, and counters persist across reloads", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(1, 2);
    app.select("intTool");
    app.elements.intName.value = "Polaris";
    app.elements.intBearing.value = "360";
    app.elements.intDistance.value = "-4.75";
    app.submit("intForm");
    app.interceptHandles[0].dragTo({ lat: 1.1, lng: 2 });
    app.interceptHandles[0].endDrag();
    app.interceptHandles[2].dragTo({ lat: 1.02, lng: 2.05 });
    app.interceptHandles[2].endDrag();

    const saved = JSON.parse(app.storageValues.get("navi-tools.navigation.v1"));
    assert.equal(saved.intercepts[0].bearing, 0);
    assert.equal(saved.intercepts[0].interceptNM, -4.75);
    assert.notEqual(saved.intercepts[0].arrowLengthNM, 1.5);
    assert.notEqual(saved.intercepts[0].lopNegativeNM, 1);

    const restored = createApp({ storageValues: app.storageValues });
    assert.equal(restored.markers.length, 1);
    assert.equal(restored.lines.length, 3);
    assert.match(restored.interceptStars[0].options.icon.html, /Polaris/);
    assert.equal(restored.interceptHandles.length, 3);
    const restoredAnnotation = restored.annotations.find(marker =>
        marker.options.icon.className === "intercept-line-annotation-icon"
    );
    assert.match(restoredAnnotation.options.icon.html, /000°/);
    assert.match(restoredAnnotation.options.icon.html, /4\.8 nm AWAY/);
});

test("editing the AP FIX position recalculates all attached INT geometry", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "Arcturus";
    app.elements.intBearing.value = "90";
    app.elements.intDistance.value = "5";
    app.submit("intForm");
    const originalArrowStart = app.lines[0].latlngs[0];

    app.markers[0].fire("click");
    app.elements.pointLabel.value = "AP";
    app.elements.pointPosition.value = "N 10° 00.000' - E 020° 00.000'";
    app.submit("pointInfo");

    assert.equal(app.lines[0].latlngs[0], app.markers[0].getLatLng());
    assert.ok(Math.abs(app.lines[0].latlngs[0].lat - originalArrowStart.lat) > 1);
    assert.equal(app.interceptStars[0].latlng, app.interceptHandles[0].latlng);
    assert.match(app.interceptStars[0].options.icon.html, /Arcturus/);
});

test("deleting any INT line removes its sight group but keeps the AP FIX", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "Deneb";
    app.elements.intBearing.value = "180";
    app.elements.intDistance.value = "-3";
    app.submit("intForm");
    const fix = app.markers[0];

    app.lines[2].fire("click");
    app.deleteKey();
    assert.match(app.confirmations[0], /all INT lines and the star/);
    assert.equal(app.lines.every(line => !app.layers.has(line)), true);
    assert.equal(app.interceptHandles.every(handle => !app.layers.has(handle)), true);
    assert.equal(app.layers.has(app.interceptStars[0]), false);
    assert.equal(app.layers.has(fix), true);
    assert.equal(app.text(), "INT lines deleted");
    const restored = createApp({ storageValues: app.storageValues });
    assert.equal(restored.markers.length, 1);
    assert.equal(restored.lines.length, 0);
});

test("deleting the AP FIX confirms and removes its attached INT sight", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "Spica";
    app.elements.intBearing.value = "270";
    app.elements.intDistance.value = "2";
    app.submit("intForm");
    const fix = app.markers[0];
    const star = app.interceptStars[0];

    fix.fire("click");
    app.deleteKey();
    assert.match(app.confirmations[0], /attached INT sight/);
    assert.equal(app.layers.has(fix), false);
    assert.equal(app.layers.has(star), false);
    assert.equal(app.lines.every(line => !app.layers.has(line)), true);
    const restored = createApp({ storageValues: app.storageValues });
    assert.equal(restored.markers.length, 0);
    assert.equal(restored.lines.length, 0);
});

test("cancelling INT deletion and invalid saved INT data preserve the AP and stored graph", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "Capella";
    app.elements.intBearing.value = "45";
    app.elements.intDistance.value = "3";
    app.submit("intForm");
    app.lines[0].fire("click");
    app.setConfirmResult(false);
    app.deleteKey();
    assert.equal(app.layers.has(app.markers[0]), true);
    assert.equal(app.lines.every(line => app.layers.has(line)), true);

    const storedBeforeInvalidRestore = app.storageValues.get("navi-tools.navigation.v1");
    const corrupted = JSON.parse(storedBeforeInvalidRestore);
    corrupted.intercepts[0].bearing = -1;
    app.storageValues.set("navi-tools.navigation.v1", JSON.stringify(corrupted));
    const invalidRestore = createApp({ storageValues: app.storageValues });
    assert.equal(invalidRestore.markers.length, 0);
    assert.match(invalidRestore.text(), /Navigation data load failed/);
    assert.equal(
        app.storageValues.get("navi-tools.navigation.v1"),
        JSON.stringify(corrupted)
    );
});

test("INT rejects missing names, invalid bearings, and nonnumeric distances", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "";
    app.elements.intBearing.value = "361";
    app.elements.intDistance.value = "10";
    app.submit("intForm");
    assert.equal(app.elements.intPopup.hidden, false);
    assert.match(app.elements.intError.textContent, /star name/);
    assert.equal(app.lines.length, 0);

    app.elements.intName.value = "Mira";
    app.elements.intBearing.value = "10";
    app.elements.intDistance.value = "not-a-number";
    app.submit("intForm");
    assert.equal(app.lines.length, 0);
});

test("INT escapes the star name in the star marker and both LOP labels", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("intTool");
    app.elements.intName.value = "<img src=x onerror=alert(1)>";
    app.elements.intBearing.value = "15";
    app.elements.intDistance.value = "1";
    app.submit("intForm");

    assert.match(app.interceptStars[0].options.icon.html, /&lt;img/);
    assert.doesNotMatch(app.interceptStars[0].options.icon.html, /<img/);
    const lopLabel = app.annotations.find(marker =>
        marker.options.icon.className === "intercept-lop-label-icon"
    );
    assert.match(lopLabel.options.icon.html, /&lt;img/);
    assert.doesNotMatch(lopLabel.options.icon.html, /<img/);
});

test("GCR connects a selected FIX to a new FIX with a dark-blue great-circle route", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    const startFix = app.markers[0];

    assert.equal(app.elements.gcrTool.disabled, false);
    app.select("gcrTool");
    assert.match(app.text(), /final FIX for a Great Circle Route/);
    app.click(60, 60);

    const endFix = app.markers[1];
    const route = app.lines[0];
    assert.equal(endFix.options.alt, "FIX 2");
    assert.equal(endFix.options.draggable, true);
    assert.equal(route.options.color, "#003366");
    assert.ok(route.latlngs.length > 2);
    assert.ok(route.latlngs[Math.floor(route.latlngs.length / 2)].lat > 30);
    assert.ok(Math.abs(route.latlngs[0].lat - startFix.getLatLng().lat) < 1e-10);
    assert.equal(route.latlngs[0].lng, startFix.getLatLng().lng);
    assert.ok(Math.abs(route.latlngs.at(-1).lat - endFix.getLatLng().lat) < 1e-10);
    assert.equal(route.latlngs.at(-1).lng, endFix.getLatLng().lng);
    assert.equal(app.elements.gcrTool.disabled, false);
});

test("moving either GCR endpoint recalculates the route and preserves the other endpoint", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(10, 20);
    app.select("gcrTool");
    app.click(40, 70);

    const [startFix, endFix] = app.markers;
    const route = app.lines[0];
    const originalEnd = endFix.getLatLng();
    startFix.dragTo({ lat: 15, lng: 25 });
    assert.ok(Math.abs(route.latlngs[0].lat - 15) < 1e-10);
    assert.equal(route.latlngs[0].lng, 25);
    assert.equal(endFix.getLatLng().lat, originalEnd.lat);
    assert.equal(endFix.getLatLng().lng, originalEnd.lng);

    const originalStart = startFix.getLatLng();
    endFix.dragTo({ lat: 45, lng: 75 });
    assert.equal(route.latlngs[0].lat, originalStart.lat);
    assert.equal(route.latlngs[0].lng, originalStart.lng);
    assert.ok(Math.abs(route.latlngs.at(-1).lat - 45) < 1e-10);
    assert.equal(route.latlngs.at(-1).lng, 75);
});

test("GCR routes persist across reloads and are removed when their FIX is deleted", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(1, 2);
    app.select("gcrTool");
    app.click(3, 4);

    const restored = createApp({ storageValues: app.storageValues });
    assert.equal(restored.markers.length, 2);
    assert.equal(restored.lines.length, 1);
    assert.equal(restored.lines[0].options.color, "#003366");
    assert.equal(restored.lines[0].latlngs.length > 2, true);

    restored.markers[0].fire("click");
    restored.deleteKey();
    const afterDelete = createApp({ storageValues: restored.storageValues });
    assert.equal(afterDelete.markers.length, 1);
    assert.equal(afterDelete.lines.length, 0);
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

test("FIX dragging updates geometry immediately and defers label refresh until drag end", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);
    app.select("drTool");
    app.elements.drBearing.value = "90";
    app.elements.drDistance.value = "60";
    app.submit("drForm");

    const fixIconBeforeDrag = app.markers[0].icon;
    const drIconBeforeDrag = app.markers[1].icon;
    const annotationIconBeforeDrag = app.annotations[0].icon;
    app.markers[0].dragTo({ lat: 10, lng: 20 });

    assert.equal(app.markers[0].icon, fixIconBeforeDrag);
    assert.equal(app.markers[1].icon, drIconBeforeDrag);
    assert.equal(app.annotations[0].icon, annotationIconBeforeDrag);
    assert.equal(app.lines[0].latlngs[0].lat, 10);
    assert.ok(Math.abs(app.markers[1].getLatLng().lat - 10) < 0.003);

    app.endDrag(0);

    assert.notEqual(app.markers[0].icon, fixIconBeforeDrag);
    assert.notEqual(app.markers[1].icon, drIconBeforeDrag);
    assert.notEqual(app.annotations[0].icon, annotationIconBeforeDrag);
    assert.match(app.markers[0].icon.html, /N 10° 00\.0'/);
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
        "S 12° 30.00' - W 003° 15.00'"
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
    assert.equal(
        app.elements.pointPosition.value,
        "S 12° 30.50' - W 003° 15.25'"
    );

    app.elements.pointPosition.value = "N 90° 00.001' - E 010° 00.000'";
    app.submit("pointInfo");
    assert.equal(app.markers[0].getLatLng().lat, -12.508333333333333);
    assert.match(app.text(), /format N 54°/);
});

test("FIX position parsing accepts flexible minute precision, optional separators, and east O", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(0, 0);

    [
        ["N 12° 4.4' E 3° 5'", 12 + 4.4 / 60, 3 + 5 / 60],
        ["S 12° 4.40' - O 3° 5.00'", -(12 + 4.4 / 60), 3 + 5 / 60],
        ["N 12° 4.400' O 3°", 12 + 4.4 / 60, 3],
        ["S 12° W 3° 5.250'", -12, -(3 + 5.25 / 60)]
    ].forEach(([position, latitude, longitude]) => {
        app.elements.pointPosition.value = position;
        app.submit("pointInfo");
        assert.ok(Math.abs(app.markers[0].getLatLng().lat - latitude) < 1e-10);
        assert.ok(Math.abs(app.markers[0].getLatLng().lng - longitude) < 1e-10);
    });

    assert.equal(app.elements.pointPosition.value, "S 12° 00.00' - W 003° 05.25'");
});

test("FIX position input does not apply a conflicting native format pattern", () => {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    const pointPositionInput = html.match(/<input\b[^>]*id="pointPosition"[^>]*>/);

    assert.ok(pointPositionInput);
    assert.doesNotMatch(pointPositionInput[0], /\spattern=/);
    assert.match(
        pointPositionInput[0],
        /placeholder="N 54° 10\.12' - E 10° 12\.34'"/
    );
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

test("grid labels use padded degrees and precision appropriate to grid spacing", () => {
    const app = createApp();
    assert.equal(app.formatGridCoordinate(30, true), "N 30°");
    assert.equal(app.formatGridCoordinate(30.2, true), "N 30° 12'");
    assert.equal(app.formatGridCoordinate(-12.25, true), "S 12° 15'");
    assert.equal(app.formatGridCoordinate(10.2666666667, false), "E 010° 16'");
    assert.equal(app.formatGridCoordinate(-3.999999, false), "W 004°");
    assert.equal(app.formatGridCoordinate(30 + 12.1 / 60, true, 1), "N 30° 12.1'");
    assert.equal(app.formatGridCoordinate(30.2, true, 1), "N 30° 12'");
    assert.equal(app.formatGridCoordinate(30 + 12.12 / 60, true, 2), "N 30° 12.12'");
});

test("zoomed-in grid labels show fractional minutes where grid spacing requires it", () => {
    const app = createApp();
    app.setGridPixelBounds({
        min: { x: 10, y: 10 },
        max: { x: 246, y: 246 }
    });

    app.grid().createTile({ x: 0, y: 0, z: 15 });

    assert.equal(
        app.gridLabels.some(label => /^[EW] \d{3}° \d{2}\.\d+'$/.test(label)),
        true
    );
    assert.equal(
        app.gridLabels.some(label => /^[NS] \d{2}° \d{2}\.\d+'$/.test(label)),
        true
    );
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

test("navigation points, branches, edits, and counters survive app reloads", () => {
    const firstSession = createApp();
    firstSession.select("fixTool");
    firstSession.click(10, 20);
    firstSession.elements.pointLabel.value = "Harbor";
    firstSession.elements.pointPosition.value =
        "N 10° 00.000' - E 020° 00.000'";
    firstSession.submit("pointInfo");

    firstSession.select("drTool");
    firstSession.elements.drBearing.value = "90";
    firstSession.elements.drDistance.value = "60";
    firstSession.submit("drForm");
    firstSession.select("drTool");
    firstSession.elements.drBearing.value = "0";
    firstSession.elements.drDistance.value = "60";
    firstSession.submit("drForm");
    firstSession.markers[0].fire("click");
    firstSession.select("drTool");
    firstSession.elements.drBearing.value = "180";
    firstSession.elements.drDistance.value = "10";
    firstSession.submit("drForm");

    firstSession.markers[0].dragTo({ lat: 11, lng: 21 });
    firstSession.endDrag(0);
    firstSession.lines[0].fire("click");
    firstSession.elements.lineBearing.value = "45";
    firstSession.elements.lineDistance.value = "12.5";
    firstSession.submit("lineInfo");

    const restored = createApp({ storageValues: firstSession.storageValues });
    assert.equal(restored.markers.length, 4);
    assert.equal(restored.lines.length, 3);
    assert.deepEqual(
        restored.markers.map(marker => marker.options.alt),
        ["Harbor", "DR 1", "DR 2", "DR 3"]
    );
    assert.equal(restored.markers[0].getLatLng().lat, 11);
    assert.equal(restored.markers[0].getLatLng().lng, 21);
    assert.equal(restored.lines[0].latlngs[0], restored.markers[0].getLatLng());
    assert.equal(restored.markers[1].getLatLng().lat, firstSession.markers[1].getLatLng().lat);

    restored.markers[0].fire("click");
    restored.select("drTool");
    restored.elements.drBearing.value = "0";
    restored.elements.drDistance.value = "1";
    restored.submit("drForm");
    assert.equal(restored.markers.at(-1).options.alt, "DR 4");

    restored.select("fixTool");
    restored.click(30, 40);
    assert.equal(restored.markers.at(-1).options.alt, "FIX 2");
});

test("clear removes saved navigation data as well as map objects", () => {
    const app = createApp();
    app.select("fixTool");
    app.click(1, 2);
    assert.equal(app.storageValues.size, 1);

    app.select("clearTool");

    assert.equal(app.storageValues.size, 0);
    const reloaded = createApp({ storageValues: app.storageValues });
    assert.equal(reloaded.markers.length, 0);
    assert.equal(reloaded.lines.length, 0);
});

test("map viewport is saved after movement and restored on reload", () => {
    const app = createApp();
    assert.deepEqual(app.viewport(), {
        center: { lat: 54, lng: 10 },
        zoom: 6
    });

    app.setViewport(37.5, -122.25, 9);
    assert.deepEqual(
        JSON.parse(app.storageValues.get("navi-tools.viewport.v1")),
        { lat: 37.5, lng: -122.25, zoom: 9 }
    );

    const restored = createApp({ storageValues: app.storageValues });
    assert.deepEqual(restored.viewport(), {
        center: { lat: 37.5, lng: -122.25 },
        zoom: 9
    });
});

test("storage read, write, and invalid-data failures are shown to the user", () => {
    const readFailure = createApp({ failStorageRead: true });
    assert.match(readFailure.text(), /Navigation data load map viewport failed/);

    const writeFailure = createApp({ failStorageWrite: true });
    writeFailure.select("fixTool");
    writeFailure.click(1, 2);
    assert.match(writeFailure.text(), /Navigation data save failed/);
    writeFailure.setViewport(40, -70, 8);
    assert.match(writeFailure.text(), /Navigation data save map viewport failed/);

    const failedGcrSave = createApp({ failStorageWrite: true });
    failedGcrSave.select("fixTool");
    failedGcrSave.click(1, 2);
    failedGcrSave.select("gcrTool");
    failedGcrSave.click(3, 4);
    assert.match(failedGcrSave.text(), /Navigation data save failed/);

    const failedBearingSave = createApp({ failStorageWrite: true });
    failedBearingSave.select("fixTool");
    failedBearingSave.click(1, 2);
    failedBearingSave.select("brgToTool");
    failedBearingSave.elements.brgToBearing.value = "90";
    failedBearingSave.submit("brgToForm");
    assert.match(failedBearingSave.text(), /Navigation data save failed/);

    const failedInterceptSave = createApp({ failStorageWrite: true });
    failedInterceptSave.select("fixTool");
    failedInterceptSave.click(1, 2);
    failedInterceptSave.select("intTool");
    failedInterceptSave.elements.intName.value = "Sirius";
    failedInterceptSave.elements.intBearing.value = "90";
    failedInterceptSave.elements.intDistance.value = "2";
    failedInterceptSave.submit("intForm");
    assert.match(failedInterceptSave.text(), /Navigation data save failed/);

    const storageValues = new Map([
        ["navi-tools.navigation.v1", "{not valid JSON"]
    ]);
    const invalidState = createApp({ storageValues });
    assert.equal(invalidState.markers.length, 0);
    assert.match(invalidState.text(), /Navigation data load failed/);
    assert.equal(storageValues.get("navi-tools.navigation.v1"), "{not valid JSON");

    const invalidViewportValues = new Map([
        ["navi-tools.viewport.v1", JSON.stringify({ lat: 100, lng: 0, zoom: 7 })]
    ]);
    const invalidViewport = createApp({ storageValues: invalidViewportValues });
    assert.deepEqual(invalidViewport.viewport(), {
        center: { lat: 54, lng: 10 },
        zoom: 6
    });
    assert.match(invalidViewport.text(), /load map viewport failed/);
    assert.equal(
        invalidViewportValues.get("navi-tools.viewport.v1"),
        JSON.stringify({ lat: 100, lng: 0, zoom: 7 })
    );
});
