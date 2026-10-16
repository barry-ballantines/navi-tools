const map = L.map("map").setView([54.0, 10.0], 6);

const osm = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
    }
);

const seamark = L.tileLayer(
    "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenSeaMap"
    }
);

const gridSteps = [180, 90, 45, 30, 15, 6, 3, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01, 0.005];

function formatGridCoordinate(value, isLatitude) {
    const hemisphere = isLatitude
        ? (value < 0 ? "S" : "N")
        : (value < 0 ? "W" : "E");
    const totalMinuteHundredths = Math.round(Math.abs(value) * 6000);
    const degrees = Math.floor(totalMinuteHundredths / 6000);
    const minuteHundredths = totalMinuteHundredths % 6000;
    const degreeDigits = isLatitude ? 2 : 3;

    return (
        hemisphere +
        " " +
        String(degrees).padStart(degreeDigits, "0") +
        "° " +
        (minuteHundredths / 100).toFixed(2).padStart(5, "0") +
        "'"
    );
}

const CoordinateGrid = L.GridLayer.extend({
    createTile(coords) {
        const size = this.getTileSize();
        const tile = document.createElement("canvas");
        tile.width = size.x;
        tile.height = size.y;

        const context = tile.getContext("2d");
        const step = gridSteps[Math.min(coords.z, gridSteps.length - 1)];
        const tileTopLeft = L.point(coords.x * size.x, coords.y * size.y);
        const tileBottomRight = L.point(
            (coords.x + 1) * size.x,
            (coords.y + 1) * size.y
        );
        const northWest = map.unproject(tileTopLeft, coords.z);
        const southEast = map.unproject(tileBottomRight, coords.z);
        const tileOffset = L.point(coords.x * size.x, coords.y * size.y);

        context.strokeStyle = "rgba(22, 83, 100, 0.45)";
        context.fillStyle = "rgba(18, 56, 70, 0.85)";
        context.lineWidth = 1;
        context.font = "11px Arial, sans-serif";

        for (
            let longitude = Math.ceil(northWest.lng / step) * step;
            longitude <= southEast.lng;
            longitude += step
        ) {
            const x = map.project(L.latLng(0, longitude), coords.z).x - tileOffset.x;
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, size.y);
            context.stroke();
            const label = formatGridCoordinate(longitude, false);
            const labelWidth = context.measureText(label).width;
            context.fillText(
                label,
                Math.max(2, Math.min(x + 3, size.x - labelWidth - 2)),
                size.y - 5
            );
        }

        for (
            let latitude = Math.ceil(southEast.lat / step) * step;
            latitude <= northWest.lat;
            latitude += step
        ) {
            const y = map.project(L.latLng(latitude, 0), coords.z).y - tileOffset.y;
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(size.x, y);
            context.stroke();
            context.fillText(
                formatGridCoordinate(latitude, true),
                4,
                Math.max(12, y - 3)
            );
        }

        return tile;
    }
});

const coordinateGrid = new CoordinateGrid({
    pane: "overlayPane",
    opacity: 0.7
});

osm.addTo(map);
seamark.addTo(map);
coordinateGrid.addTo(map);

L.control.layers(
    { "OpenStreetMap": osm },
    {
        "Nautical Marks (OpenSeaMap)": seamark,
        "Latitude/Longitude Grid": coordinateGrid
    },
    { collapsed: true }
).addTo(map);

let mode = null;
let points = [];
let objects = [];
let measurements = [];
let selectedObject = null;

const info = document.getElementById("info");
const compassRose = document.querySelector(".compass-rose");
const magneticCompassRose = document.getElementById("magCompassRose");
const magneticVariationText = document.getElementById("magCompassTextTop");
const annualVariationText = document.getElementById("magCompassTextBottom");
const magneticModelUrl =
    "https://raw.githubusercontent.com/boxpet/pygeomag/2b8ac57f08bc100ee1f103dbca4e1a8de65ff5e8/pygeomag/wmm/WMM_2025.COF";
let magneticModelPromise;

async function updateMagneticVariation() {
    try {
        if (!magneticModelPromise) {
            magneticModelPromise = fetch(magneticModelUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error("WMM2025 model request failed: " + response.status);
                    }
                    return response.text();
                })
                .then(coefficientFile => geoMagFactory(cof2Obj(coefficientFile)));
        }

        const geoMag = await magneticModelPromise;
        const roseBounds = compassRose.getBoundingClientRect();
        const mapBounds = map.getContainer().getBoundingClientRect();
        const roseCenter = L.point(
            roseBounds.left + roseBounds.width / 2 - mapBounds.left,
            roseBounds.top + roseBounds.height / 2 - mapBounds.top
        );
        const location = map.containerPointToLatLng(roseCenter);
        const now = new Date();
        const nextYear = new Date(now);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        const variation = geoMag(location.lat, location.lng, 0, now).dec;
        const nextVariation = geoMag(location.lat, location.lng, 0, nextYear).dec;

        magneticCompassRose.style.transform = "rotate(" + variation.toFixed(1) + "deg)";
        magneticVariationText.textContent =
            "VAR " +
            Math.abs(variation).toFixed(1) +
            "°" +
            (variation >= 0 ? "E" : "W") +
            " (" +
            now.getFullYear() +
            ")";
        annualVariationText.textContent =
            "ANNUAL " +
            (nextVariation >= variation ? "INCREASE " : "DECREASE ") +
            (Math.abs(nextVariation - variation) * 60).toFixed(0) +
            "'";
    } catch (error) {
        console.error("Magnetic variation could not be calculated.", error);
        magneticVariationText.textContent = "Magnetic variation unavailable";
        annualVariationText.textContent = "WMM2025";
    }
}

let compassPointerAction = null;

compassRose.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.pointerType === "mouse") {
        return;
    }

    const roseBounds = compassRose.getBoundingClientRect();
    const mapBounds = map.getContainer().getBoundingClientRect();
    compassRose.style.left = roseBounds.left - mapBounds.left + "px";
    compassRose.style.top = roseBounds.top - mapBounds.top + "px";
    compassRose.style.right = "auto";
    compassRose.style.bottom = "auto";
    const resizeHandle = event.target.closest(".compass-resize");
    compassPointerAction = {
        type: resizeHandle ? "resize" : "move",
        pointerId: event.pointerId,
        offsetX: event.clientX - roseBounds.left,
        offsetY: event.clientY - roseBounds.top,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: roseBounds.width,
        startHeight: roseBounds.height
    };
    compassRose.setPointerCapture(event.pointerId);
    map.dragging.disable();
    compassRose.classList.add(
        resizeHandle ? "resizing" : "dragging"
    );
    event.preventDefault();
});

compassRose.addEventListener("pointermove", event => {
    if (!compassPointerAction || event.pointerId !== compassPointerAction.pointerId) {
        return;
    }

    const mapBounds = map.getContainer().getBoundingClientRect();
    if (compassPointerAction.type === "resize") {
        const left = parseFloat(compassRose.style.left) || 0;
        const top = parseFloat(compassRose.style.top) || 0;
        const maxSize = Math.min(
            420,
            mapBounds.width - left,
            mapBounds.height - top
        );
        const size = Math.max(
            100,
            Math.min(
                maxSize,
                compassPointerAction.startWidth +
                    event.clientX - compassPointerAction.startX,
                compassPointerAction.startHeight +
                    event.clientY - compassPointerAction.startY
            )
        );
        compassRose.style.width = size + "px";
        compassRose.style.height = size + "px";
        return;
    }

    const maxLeft = mapBounds.width - compassRose.offsetWidth;
    const maxTop = mapBounds.height - compassRose.offsetHeight;
    const left = Math.max(
        0,
        Math.min(maxLeft, event.clientX - mapBounds.left - compassPointerAction.offsetX)
    );
    const top = Math.max(
        0,
        Math.min(maxTop, event.clientY - mapBounds.top - compassPointerAction.offsetY)
    );

    compassRose.style.left = left + "px";
    compassRose.style.top = top + "px";
});

function finishCompassDrag(event) {
    if (!compassPointerAction || event.pointerId !== compassPointerAction.pointerId) {
        return;
    }

    compassPointerAction = null;
    map.dragging.enable();
    compassRose.classList.remove("dragging");
    compassRose.classList.remove("resizing");
    updateMagneticVariation();
}

compassRose.addEventListener("pointerup", finishCompassDrag);
compassRose.addEventListener("pointercancel", finishCompassDrag);

map.on("moveend", updateMagneticVariation);
const magneticVariationUpdate = updateMagneticVariation();
const pointIcon = selected => L.divIcon({
    className: selected
        ? "measurement-point measurement-point-selected"
        : "measurement-point",
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

function selectObject(object) {
    if (selectedObject === object) {
        return;
    }

    if (selectedObject) {
        if (selectedObject instanceof L.Marker) {
            selectedObject.setIcon(pointIcon(false));
        } else {
            selectedObject.setStyle({ color: "red", weight: 3 });
        }
    }

    selectedObject = object;

    if (object instanceof L.Marker) {
        object.setIcon(pointIcon(true));
    } else {
        object.setStyle({ color: "orange", weight: 5 });
    }
}

function removeObject(object) {
    if (!objects.includes(object)) {
        return;
    }

    const affectedMeasurements = measurements.filter(measurement =>
        measurement.line === object || measurement.endpoints.includes(object)
    );

    if (object instanceof L.Marker) {
        const remainingEndpoint = affectedMeasurements
            .flatMap(measurement => measurement.endpoints)
            .find(endpoint => endpoint !== object);

        affectedMeasurements.forEach(measurement => {
            map.removeLayer(measurement.line);
            objects = objects.filter(item => item !== measurement.line);
            if (selectedObject === measurement.line) {
                selectedObject = null;
            }
        });
        measurements = measurements.filter(measurement =>
            !affectedMeasurements.includes(measurement)
        );
        points = points.filter(point => point !== object);

        if (remainingEndpoint) {
            points = [remainingEndpoint];
            mode = "los";
            activateButton("losTool");
            info.innerHTML = "LOS active<br>Set the next point";
        }
    } else {
        measurements = measurements.filter(measurement =>
            measurement.line !== object
        );
    }

    if (selectedObject === object) {
        selectedObject = null;
    }

    map.removeLayer(object);
    objects = objects.filter(item => item !== object);

    if (!points.length) {
        info.innerHTML = "Object deleted";
    }
}

document.addEventListener("keydown", event => {
    if (
        event.key !== "Delete" ||
        (event.target && event.target.isContentEditable) ||
        (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
    ) {
        return;
    }

    if (selectedObject) {
        event.preventDefault();
        removeObject(selectedObject);
    }
});

function activateButton(id) {
    document
        .querySelectorAll(".toolbar button")
        .forEach(btn => btn.classList.remove("active"));

    document
        .getElementById(id)
        .classList.add("active");
}

document.getElementById("losTool").onclick = () => {
    mode = "los";
    activateButton("losTool");
    info.innerHTML = "LOS active<br>Set point 1";
};

document.getElementById("clearTool").onclick = () => {
    objects.forEach(obj => map.removeLayer(obj));

    objects = [];
    points = [];
    measurements = [];
    selectedObject = null;
    mode = null;

    document
        .querySelectorAll(".toolbar button")
        .forEach(btn => btn.classList.remove("active"));

    info.innerHTML = "Cleared";
};

function distanceNM(a, b) {

    const R = 6371000;

    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;

    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lng - a.lng) * Math.PI / 180;

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(dLon / 2) ** 2;

    const c =
        2 *
        Math.atan2(
            Math.sqrt(h),
            Math.sqrt(1 - h)
        );

    return (R * c) / 1852;
}

function bearing(start, end) {

    const lat1 = start.lat * Math.PI / 180;
    const lat2 = end.lat * Math.PI / 180;

    const dLon =
        (end.lng - start.lng) *
        Math.PI / 180;

    const y =
        Math.sin(dLon) *
        Math.cos(lat2);

    const x =
        Math.cos(lat1) *
        Math.sin(lat2) -
        Math.sin(lat1) *
        Math.cos(lat2) *
        Math.cos(dLon);

    return (
        (
            Math.atan2(y, x) *
            180 / Math.PI
        ) + 360
    ) % 360;
}

map.on("click", (e) => {

    if (!mode) {
        return;
    }

    const marker = L.marker(
        e.latlng,
        {
            draggable: true,
            bubblingMouseEvents: false,
            title: "Drag to move point",
            alt: "Draggable measurement point",
            icon: L.divIcon({
                className: "measurement-point",
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        }
    ).addTo(map);

    marker.on("click", () => selectObject(marker));
    objects.push(marker);
    points.push(marker);

    if (points.length < 2) {
        return;
    }

    const endpoints = points;

    const line = L.polyline(
        endpoints.map(point => point.getLatLng()),
        {
            color: "red",
            weight: 3,
            bubblingMouseEvents: false
        }
    ).addTo(map);

    line.on("click", () => selectObject(line));
    objects.push(line);
    const measurement = { endpoints, line };
    measurements.push(measurement);

    function updateMeasurement() {
        const [p1, p2] = endpoints.map(point => point.getLatLng());
        line.setLatLngs([p1, p2]);

        const dist = distanceNM(p1, p2);
        const kurs = bearing(p1, p2);

        info.innerHTML =
            "<b>LOS</b><br>" +
            "Distance: " +
            dist.toFixed(2) +
            " nm<br>" +
            "Bearing: " +
            kurs.toFixed(1) +
            "°";
    }

    endpoints.forEach(point => point.on("drag", updateMeasurement));
    updateMeasurement();
    points = [];
});