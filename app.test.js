const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createApp() {
    const elements = Object.fromEntries(
        ["info", "losTool", "clearTool"]
            .map(id => [id, {
                innerHTML: "",
                classList: { add() {}, remove() {} }
            }])
    );
    const layers = new Set();
    const markers = [];
    const lines = [];
    const handlers = {};
    const documentHandlers = {};
    const map = {
        setView() { return this; },
        on(event, handler) { handlers[event] = handler; },
        removeLayer(layer) { layers.delete(layer); }
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
    const L = {
        Marker: MockMarker,
        map: () => map,
        tileLayer: () => ({
            addTo() {
                layers.add(this);
                return this;
            }
        }),
        divIcon: options => options,
        marker: (latlng, options) => new MockMarker(latlng, options),
        polyline: (latlngs, options) => new MockPolyline(latlngs, options)
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "app.js"), "utf8"),
        {
            L,
            document: {
                getElementById: id => elements[id],
                querySelectorAll: () => Object.values(elements),
                addEventListener: (event, handler) => {
                    documentHandlers[event] = handler;
                }
            }
        }
    );
    return {
        elements, markers, lines, layers,
        click: (lat, lng) => handlers.click({ latlng: { lat, lng } }),
        select: id => elements[id].onclick(),
        text: () => elements.info.innerHTML,
        deleteKey: (key = "Delete", target = { tagName: "BODY" }) =>
            documentHandlers.keydown({ key, target, preventDefault() {} })
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
    assert.equal(app.layers.size, 2);
    assert.equal(app.text(), "Gelöscht");
    app.click(2, 2);
    assert.equal(app.markers.length, 3);
    app.select("losTool");
    app.click(0, 0);
    assert.equal(app.lines.length, 1);
    app.click(0, 1);
    assert.equal(app.lines.length, 2);
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
