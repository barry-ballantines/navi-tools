const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createApp() {
    const elements = Object.fromEntries(
        ["info", "distanceTool", "bearingTool", "losTool", "clearTool"]
            .map(id => [id, {
                innerHTML: "",
                classList: { add() {}, remove() {} }
            }])
    );
    const layers = new Set();
    const markers = [];
    const lines = [];
    const handlers = {};
    const map = {
        setView() { return this; },
        on(event, handler) { handlers[event] = handler; },
        removeLayer(layer) { layers.delete(layer); }
    };
    function layer(properties = {}) {
        return {
            ...properties,
            addTo() {
                layers.add(this);
                return this;
            }
        };
    }
    const L = {
        map: () => map,
        tileLayer: () => layer(),
        divIcon: options => options,
        marker(latlng, options) {
            const events = {};
            const marker = layer({
                latlng,
                options,
                getLatLng() { return this.latlng; },
                on(event, handler) { events[event] = handler; },
                dragTo(position) {
                    this.latlng = position;
                    if (events.drag) {
                        events.drag();
                    }
                }
            });
            markers.push(marker);
            return marker;
        },
        polyline(latlngs) {
            const line = layer({
                latlngs,
                setLatLngs(positions) { this.latlngs = positions; }
            });
            lines.push(line);
            return line;
        }
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "app.js"), "utf8"),
        {
            L,
            document: {
                getElementById: id => elements[id],
                querySelectorAll: () => Object.values(elements)
            }
        }
    );
    return {
        elements, markers, lines, layers,
        click: (lat, lng) => handlers.click({ latlng: { lat, lng } }),
        select: id => elements[id].onclick(),
        text: () => elements.info.innerHTML
    };
}

test("a pending endpoint can move before its line is created", () => {
    const app = createApp();
    app.click(0, 0);
    assert.equal(app.markers.length, 0);
    app.select("distanceTool");
    app.click(0, 0);
    assert.equal(app.markers[0].options.draggable, true);
    assert.equal(app.markers[0].options.bubblingMouseEvents, false);
    assert.equal(app.markers[0].options.icon.iconSize.join(","), "24,24");
    app.markers[0].dragTo({ lat: 0, lng: 1 });
    app.click(0, 2);
    assert.equal(app.lines[0].latlngs[0].lng, 1);
    assert.equal(app.text(), "<b>Stechzirkel</b><br>60.04 sm");
});

test("dragging either endpoint updates its line and distance", () => {
    const app = createApp();
    app.select("distanceTool");
    app.click(0, 0);
    app.click(0, 1);
    app.markers[1].dragTo({ lat: 0, lng: 2 });
    assert.equal(app.lines[0].latlngs[1].lng, 2);
    assert.equal(app.text(), "<b>Stechzirkel</b><br>120.08 sm");
    app.markers[0].dragTo({ lat: 0, lng: 1 });
    assert.equal(app.lines[0].latlngs[0].lng, 1);
    assert.equal(app.text(), "<b>Stechzirkel</b><br>60.04 sm");
    assert.equal(app.markers.length, 2);
});

test("old measurements retain their mode and do not move newer lines", () => {
    const app = createApp();
    app.select("bearingTool");
    app.click(0, 0);
    app.click(0, 1);
    assert.equal(app.text(), "<b>Peilung</b><br>90.0°");
    app.select("losTool");
    app.click(10, 10);
    app.click(11, 10);
    const newerLine = app.lines[1].latlngs;
    app.markers[1].dragTo({ lat: 1, lng: 0 });
    assert.equal(app.text(), "<b>Peilung</b><br>0.0°");
    assert.equal(app.lines[1].latlngs, newerLine);
    app.markers[3].dragTo({ lat: 10, lng: 11 });
    assert.equal(app.text(), "<b>LOS</b><br>Distanz: 59.13 sm<br>Kurs: 89.9°");
});

test("clear removes completed and pending points but preserves tile layers", () => {
    const app = createApp();
    app.select("distanceTool");
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
