const navigationStorageKey = "navi-tools.navigation.v1";
const viewportStorageKey = "navi-tools.viewport.v1";
const defaultMapCenter = [54.0, 10.0];
const defaultMapZoom = 6;
let initialMapView = {
    center: defaultMapCenter,
    zoom: defaultMapZoom
};
let invalidStoredViewport = false;
let viewportReadError = null;

try {
    const storedViewport = window.localStorage.getItem(viewportStorageKey);
    if (storedViewport !== null) {
        const viewport = JSON.parse(storedViewport);
        if (!isValidStoredViewport(viewport)) {
            invalidStoredViewport = true;
        } else {
            initialMapView = {
                center: [viewport.lat, viewport.lng],
                zoom: viewport.zoom
            };
        }
    }
} catch (error) {
    viewportReadError = error;
}

const map = L.map("map", { zoomControl: false })
    .setView(initialMapView.center, initialMapView.zoom);

function isValidStoredViewport(viewport) {
    return Boolean(
        viewport &&
        Number.isFinite(viewport.lat) &&
        viewport.lat >= -90 &&
        viewport.lat <= 90 &&
        Number.isFinite(viewport.lng) &&
        viewport.lng >= -180 &&
        viewport.lng <= 180 &&
        Number.isFinite(viewport.zoom) &&
        viewport.zoom >= 0 &&
        viewport.zoom <= 19
    );
}

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

const gridSteps = [180, 90, 45, 30, 15, 6, 3, 2, 1, 30/60, 20/60, 10/60, 5/60, 2/60, 1/60, 5/600, 2/600, 1/600];

function gridMinutePrecision(gridStep) {
    const gridStepMinutes = gridStep * 60;
    return Math.max(0, Math.ceil(-Math.log10(gridStepMinutes)));
}

function formatGridCoordinate(value, isLatitude, precision = 0) {
    const hemisphere = isLatitude
        ? (value < 0 ? "S" : "N")
        : (value < 0 ? "W" : "E");
    const minuteScale = 10 ** precision;
    const totalMinutes = Math.round(Math.abs(value) * 60 * minuteScale);
    const degrees = Math.floor(totalMinutes / (60 * minuteScale));
    const minutes = (totalMinutes % (60 * minuteScale)) / minuteScale;
    const degreeDigits = isLatitude ? 2 : 3;
    const minuteText = minutes
        .toFixed(precision)
        .replace(/(\.\d*[1-9])0+$|\.0+$/, "$1");

    return (
        hemisphere +
        " " +
        String(degrees).padStart(degreeDigits, "0") +
        "°" +
        (minutes ? " " + minuteText.padStart(2, "0") + "'" : "")
    );
}

function drawGridLabel(context, label, x, y) {
    const labelWidth = context.measureText(label).width;
    const paddingX = 3;
    const paddingY = 2;
    const textHeight = 11;

    context.fillStyle = "rgba(255, 255, 255, 0.78)";
    context.fillRect(
        x - labelWidth / 2 - paddingX,
        y - textHeight / 2 - paddingY,
        labelWidth + paddingX * 2,
        textHeight + paddingY * 2
    );
    context.fillStyle = "rgba(18, 56, 70, 0.95)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x, y);
}

const CoordinateGrid = L.GridLayer.extend({
    createTile(coords) {
        const size = this.getTileSize();
        const tile = document.createElement("canvas");
        tile.width = size.x;
        tile.height = size.y;

        const context = tile.getContext("2d");
        const step = gridSteps[Math.min(coords.z, gridSteps.length - 1)];
        const minutePrecision = gridMinutePrecision(step);
        const pixelBounds = map.getPixelBounds();
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
        context.font = "9px Arial, sans-serif";
        const gridLabelTextHeight = 11;
        const topBorderY = pixelBounds.min.y - tileTopLeft.y;
        const bottomBorderY = pixelBounds.max.y - tileTopLeft.y;
        const leftBorderX = pixelBounds.min.x - tileTopLeft.x;
        const rightBorderX = pixelBounds.max.x - tileTopLeft.x;

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

            if (x >= leftBorderX && x <= rightBorderX) {
                const label = formatGridCoordinate(
                    longitude,
                    false,
                    minutePrecision
                );

                if (topBorderY >= 0 && topBorderY <= size.y) {
                    drawGridLabel(
                        context,
                        label,
                        x,
                        Math.min(
                            size.y - gridLabelTextHeight / 2,
                            topBorderY + 8
                        )
                    );
                }

                if (bottomBorderY >= 0 && bottomBorderY <= size.y) {
                    drawGridLabel(
                        context,
                        label,
                        x,
                        Math.max(
                            gridLabelTextHeight / 2,
                            bottomBorderY - 8
                        )
                    );
                }
            }
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
            if (y >= topBorderY && y <= bottomBorderY) {
                const label = formatGridCoordinate(
                    latitude,
                    true,
                    minutePrecision
                );

                if (leftBorderX >= 0 && leftBorderX <= size.x) {
                    drawGridLabel(
                        context,
                        label,
                        Math.min(size.x - 20, leftBorderX + 20),
                        y
                    );
                }

                if (rightBorderX >= 0 && rightBorderX <= size.x) {
                    drawGridLabel(
                        context,
                        label,
                        Math.max(20, rightBorderX - 20),
                        y
                    );
                }
            }
        }

        return tile;
    }
});

const coordinateGrid = new CoordinateGrid({
    pane: "overlayPane",
    opacity: 0.7
});

function redrawCoordinateGridLabels() {
    coordinateGrid.redraw();
}

osm.addTo(map);
seamark.addTo(map);
coordinateGrid.addTo(map);

map.on("moveend", redrawCoordinateGridLabels);
map.on("zoomend", redrawCoordinateGridLabels);
map.on("resize", redrawCoordinateGridLabels);

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
let navigationLines = [];
let bearingLines = [];
let intercepts = [];
let greatCircleRoutes = [];
let objects = [];
let selectedObject = null;
let gcrStartPoint = null;
let nextFixNumber = 1;
let nextDrNumber = 1;
let nextPointId = 1;
let nextLineId = 1;
let isRestoringNavigationState = false;

const infoMessage = document.getElementById("infoMessage");
const pointInfo = document.getElementById("pointInfo");
const pointType = document.getElementById("pointType");
const pointLabel = document.getElementById("pointLabel");
const pointPosition = document.getElementById("pointPosition");
const lineInfo = document.getElementById("lineInfo");
const lineBearing = document.getElementById("lineBearing");
const lineDistance = document.getElementById("lineDistance");
const drButton = document.getElementById("drTool");
const gcrButton = document.getElementById("gcrTool");
const brgToButton = document.getElementById("brgToTool");
const interceptButton = document.getElementById("intTool");
const drPopup = document.getElementById("drPopup");
const drForm = document.getElementById("drForm");
const drStartLabel = document.getElementById("drStartLabel");
const drBearing = document.getElementById("drBearing");
const drDistance = document.getElementById("drDistance");
const drError = document.getElementById("drError");
const lineTitle = document.getElementById("lineTitle");
const brgToPopup = document.getElementById("brgToPopup");
const brgToForm = document.getElementById("brgToForm");
const brgToFixLabel = document.getElementById("brgToFixLabel");
const brgToBearing = document.getElementById("brgToBearing");
const brgToError = document.getElementById("brgToError");
const interceptInfo = document.getElementById("interceptInfo");
const interceptName = document.getElementById("interceptName");
const interceptBearing = document.getElementById("interceptBearing");
const interceptDistance = document.getElementById("interceptDistance");
const intPopup = document.getElementById("intPopup");
const intForm = document.getElementById("intForm");
const intFixLabel = document.getElementById("intFixLabel");
const intName = document.getElementById("intName");
const intBearing = document.getElementById("intBearing");
const intDistance = document.getElementById("intDistance");
const intError = document.getElementById("intError");
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
function pointIcon(point, selected) {
    return L.divIcon({
        className:
            "navigation-point navigation-point-" +
            point.type.toLowerCase() +
            (selected ? " navigation-point-selected" : ""),
        html:
            '<span class="navigation-point-label">' +
            escapeHtml(point.label) +
            '</span><span class="navigation-point-position">' +
            formatMapPosition(point.latlng) +
            "</span>",
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

function setInfoMessage(message) {
    document.getElementById("info").hidden = false;
    infoMessage.textContent = message;
    pointInfo.hidden = true;
    lineInfo.hidden = true;
    interceptInfo.hidden = true;
}

function formatPositionCoordinate(value, isLatitude, precision = 2) {
    let degrees = Math.floor(Math.abs(value));
    const minuteScale = 10 ** precision;
    let minutes =
        Math.round((Math.abs(value) - degrees) * 60 * minuteScale) /
        minuteScale;
    if (minutes >= 60) {
        degrees += 1;
        minutes = 0;
    }
    const hemisphere = isLatitude
        ? (value < 0 ? "S" : "N")
        : (value < 0 ? "W" : "E");
    const degreeDigits = isLatitude ? 2 : 3;
    const [wholeMinutes, fractionalMinutes] = minutes.toFixed(precision).split(".");

    return (
        hemisphere +
        " " +
        String(degrees).padStart(degreeDigits, "0") +
        "° " +
        wholeMinutes.padStart(2, "0") +
        "." +
        fractionalMinutes +
        "'"
    );
}

function formatPosition(latlng) {
    return (
        formatPositionCoordinate(latlng.lat, true) +
        " - " +
        formatPositionCoordinate(latlng.lng, false)
    );
}

function formatMapPosition(latlng) {
    return (
        formatPositionCoordinate(latlng.lat, true, 1) +
        " " +
        formatPositionCoordinate(latlng.lng, false, 1)
    );
}

function parsePosition(value) {
    const match = value.match(
        /^\s*([NS])\s*(\d{1,2})°(?:\s*(\d{1,2})(?:\.(\d+))?')?\s*(?:-\s*)?([EWO])\s*(\d{1,3})°(?:\s*(\d{1,2})(?:\.(\d+))?')?\s*$/i
    );
    if (!match) {
        return null;
    }

    const [, latitudeHemisphere, latitudeDegreesText, latitudeMinutesText,
        latitudeFractionText, longitudeHemisphere, longitudeDegreesText,
        longitudeMinutesText, longitudeFractionText] = match;
    const latitudeDegrees = Number(latitudeDegreesText);
    const latitudeMinutes = Number(latitudeMinutesText || 0) +
        Number(latitudeFractionText ? "0." + latitudeFractionText : 0);
    const longitudeDegrees = Number(longitudeDegreesText);
    const longitudeMinutes = Number(longitudeMinutesText || 0) +
        Number(longitudeFractionText ? "0." + longitudeFractionText : 0);
    if (
        latitudeMinutes >= 60 ||
        longitudeMinutes >= 60 ||
        latitudeDegrees > 90 ||
        longitudeDegrees > 180 ||
        (latitudeDegrees === 90 && latitudeMinutes !== 0) ||
        (longitudeDegrees === 180 && longitudeMinutes !== 0)
    ) {
        return null;
    }

    const latitude =
        latitudeDegrees + latitudeMinutes / 60;
    const longitude =
        longitudeDegrees + longitudeMinutes / 60;
    return {
        lat: latitudeHemisphere.toUpperCase() === "S" ? -latitude : latitude,
        lng: longitudeHemisphere.toUpperCase() === "W" ? -longitude : longitude
    };
}

function showPointInfo(point) {
    document.getElementById("info").hidden = false;
    infoMessage.textContent = "";
    pointInfo.hidden = false;
    lineInfo.hidden = true;
    interceptInfo.hidden = true;
    pointType.textContent = point.type + " point";
    pointLabel.value = point.label;
    pointPosition.value = formatPosition(point.latlng);
    const isFix = point.type === "FIX";
    pointPosition.disabled = !isFix;
}

function showLineInfo(line) {
    document.getElementById("info").hidden = false;
    infoMessage.textContent = "";
    pointInfo.hidden = true;
    lineInfo.hidden = false;
    interceptInfo.hidden = true;
    lineTitle.textContent = bearingLines.includes(line) ? "BRG TO line" : "DR leg";
    lineBearing.value = line.bearing;
    lineDistance.value = line.distanceNM;
}

function showInterceptInfo(intercept) {
    document.getElementById("info").hidden = false;
    infoMessage.textContent = "";
    pointInfo.hidden = true;
    lineInfo.hidden = true;
    interceptInfo.hidden = false;
    interceptName.value = intercept.starName;
    interceptBearing.value = intercept.bearing;
    interceptDistance.value = intercept.interceptNM;
}

function updateSelectionStyle() {
    points.forEach(point =>
        point.marker.setIcon(pointIcon(point, point === selectedObject))
    );
    navigationLines.forEach(line =>
        line.layer.setStyle(
            line === selectedObject
                ? { color: "orange", weight: 5 }
                : { color: "red", weight: 3 }
        )
    );
    bearingLines.forEach(line =>
        line.layer.setStyle(
            line === selectedObject
                ? { color: "orange", weight: 5, dashArray: "6, 6" }
                : { color: "#555", weight: 3, dashArray: "6, 6" }
        )
    );
    intercepts.forEach(intercept => {
        const selected = intercept === selectedObject;
        const lineStyle = selected
            ? { color: "orange", weight: 5 }
            : { color: "#666", weight: 3 };
        intercept.arrowLayer.setStyle({
            ...lineStyle,
            dashArray: "6, 6"
        });
        if (intercept.awayLayer) {
            intercept.awayLayer.setStyle({
                ...lineStyle,
                dashArray: "6, 6"
            });
        }
        intercept.lopLayer.setStyle(lineStyle);
    });
    greatCircleRoutes.forEach(route =>
        route.layer.setStyle({
            color: "#003366",
            weight: route === selectedObject ? 5 : 3
        })
    );
    drButton.disabled = !selectedObject || !points.includes(selectedObject);
    gcrButton.disabled =
        !selectedObject ||
        !points.includes(selectedObject) ||
        selectedObject.type !== "FIX";
    brgToButton.disabled =
        !selectedObject ||
        !points.includes(selectedObject) ||
        selectedObject.type !== "FIX";
    interceptButton.disabled =
        !selectedObject ||
        !points.includes(selectedObject) ||
        selectedObject.type !== "FIX";
}

function selectObject(object) {
    selectedObject = object;
    updateSelectionStyle();
    if (points.includes(object)) {
        showPointInfo(object);
    } else if (navigationLines.includes(object) || bearingLines.includes(object)) {
        showLineInfo(object);
    } else if (intercepts.includes(object)) {
        showInterceptInfo(object);
    } else if (greatCircleRoutes.includes(object)) {
        setInfoMessage(
            "Great Circle Route: " +
            object.startPoint.label +
            " to " +
            object.endPoint.label
        );
    }
}

function destinationPoint(start, bearingDegrees, distanceNM) {
    const earthRadiusMeters = 6371000;
    const angularDistance = distanceNM * 1852 / earthRadiusMeters;
    const bearingRadians = bearingDegrees * Math.PI / 180;
    const latitude1 = start.lat * Math.PI / 180;
    const longitude1 = start.lng * Math.PI / 180;
    const latitude2 = Math.asin(
        Math.sin(latitude1) * Math.cos(angularDistance) +
        Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearingRadians)
    );
    const longitude2 = longitude1 + Math.atan2(
        Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitude1),
        Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2)
    );
    const longitudeDegrees = (longitude2 * 180 / Math.PI + 540) % 360 - 180;

    return {
        lat: latitude2 * 180 / Math.PI,
        lng: longitudeDegrees
    };
}

function greatCirclePath(start, end) {
    const toVector = latlng => {
        const latitude = latlng.lat * Math.PI / 180;
        const longitude = latlng.lng * Math.PI / 180;
        return [
            Math.cos(latitude) * Math.cos(longitude),
            Math.cos(latitude) * Math.sin(longitude),
            Math.sin(latitude)
        ];
    };
    const startVector = toVector(start);
    const endVector = toVector(end);
    const dot = Math.max(-1, Math.min(1,
        startVector.reduce((sum, value, index) => sum + value * endVector[index], 0)
    ));
    const angle = Math.acos(dot);
    const segmentCount = Math.max(
        1,
        Math.ceil(angle * 6371000 / (1852 * 50))
    );
    const sineAngle = Math.sin(angle);
    const path = [];
    let previousLongitude = start.lng;

    for (let index = 0; index <= segmentCount; index += 1) {
        const fraction = index / segmentCount;
        let vector;
        if (angle < 1e-8) {
            vector = startVector.map((value, axis) =>
                value * (1 - fraction) + endVector[axis] * fraction
            );
        } else if (Math.abs(sineAngle) < 1e-8) {
            const axis = Math.abs(startVector[0]) < 0.9
                ? [1, 0, 0]
                : [0, 1, 0];
            const perpendicular = [
                startVector[1] * axis[2] - startVector[2] * axis[1],
                startVector[2] * axis[0] - startVector[0] * axis[2],
                startVector[0] * axis[1] - startVector[1] * axis[0]
            ];
            const magnitude = Math.hypot(...perpendicular);
            const normalizedPerpendicular =
                perpendicular.map(value => value / magnitude);
            vector = startVector.map((value, axisIndex) =>
                value * Math.cos(Math.PI * fraction) +
                normalizedPerpendicular[axisIndex] * Math.sin(Math.PI * fraction)
            );
        } else {
            const startWeight = Math.sin((1 - fraction) * angle) / sineAngle;
            const endWeight = Math.sin(fraction * angle) / sineAngle;
            vector = startVector.map((value, axis) =>
                value * startWeight + endVector[axis] * endWeight
            );
        }

        const latitude = index === 0
            ? start.lat
            : index === segmentCount
                ? end.lat
                : Math.atan2(
                    vector[2],
                    Math.hypot(vector[0], vector[1])
                ) * 180 / Math.PI;
        let longitude = index === 0
            ? start.lng
            : index === segmentCount
                ? end.lng
                : Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
        while (longitude - previousLongitude > 180) {
            longitude -= 360;
        }
        while (longitude - previousLongitude < -180) {
            longitude += 360;
        }
        path.push({ lat: latitude, lng: longitude });
        previousLongitude = longitude;
    }
    return path;
}

function updateGreatCircleRoute(route) {
    route.layer.setLatLngs(
        greatCirclePath(route.startPoint.latlng, route.endPoint.latlng)
    );
}

function updateGreatCircleRoutesForPoint(point) {
    greatCircleRoutes
        .filter(route =>
            route.startPoint === point || route.endPoint === point
        )
        .forEach(updateGreatCircleRoute);
}

function distanceNMBetween(first, second) {
    const radians = degrees => degrees * Math.PI / 180;
    const latitudeDifference = radians(second.lat - first.lat);
    const longitudeDifference = radians(second.lng - first.lng);
    const latitude1 = radians(first.lat);
    const latitude2 = radians(second.lat);
    const haversine =
        Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(latitude1) * Math.cos(latitude2) *
        Math.sin(longitudeDifference / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, haversine))) / 1852;
}

function updateBearingLine(line, updateLabels = true) {
    const endpoint = destinationPoint(
        line.fixPoint.latlng,
        (line.bearing + 180) % 360,
        line.distanceNM
    );
    line.startPoint.latlng = endpoint;
    line.handle.setLatLng(endpoint);
    line.layer.setLatLngs([endpoint, line.fixPoint.latlng]);
    if (updateLabels) {
        updateLineAnnotation(line);
    }
}

function updateLineAndDescendants(line, updateLabels = true) {
    const start = line.startPoint.latlng;
    const end = destinationPoint(start, line.bearing, line.distanceNM);
    line.endPoint.latlng = end;
    line.endPoint.marker.setLatLng(end);
    if (updateLabels) {
        line.endPoint.marker.setIcon(
            pointIcon(line.endPoint, line.endPoint === selectedObject)
        );
    }
    line.layer.setLatLngs([start, end]);
    if (updateLabels) {
        updateLineAnnotation(line);
    }
    navigationLines
        .filter(candidate => candidate.startPoint === line.endPoint)
        .forEach(child => updateLineAndDescendants(child, updateLabels));
}

function refreshLineLabelsFromPoint(point) {
    navigationLines
        .filter(line => line.startPoint === point)
        .forEach(line => {
            line.endPoint.marker.setIcon(
                pointIcon(line.endPoint, line.endPoint === selectedObject)
            );
            updateLineAnnotation(line);
            refreshLineLabelsFromPoint(line.endPoint);
        });
}

function lineAnnotationIcon(line, angle, flipped) {
    const bearing = String(Math.round(line.bearing) % 360).padStart(3, "0") + "°";
    const sideClass = flipped
        ? " line-annotation-flipped"
        : "";

    return L.divIcon({
        className: "line-annotation-icon",
        html:
            '<span class="line-annotation-content' +
            sideClass +
            '" style="transform: translate(-50%, -50%) rotate(' +
            angle.toFixed(2) +
            'deg)"><span class="line-annotation-bearing">' +
            bearing +
            '</span><span class="line-annotation-distance">' +
            line.distanceNM.toFixed(1) +
            " nm</span></span>",
        iconSize: [0, 0],
        iconAnchor: [0, 0]
    });
}

function updateLineAnnotation(line) {
    if (!line.annotation) {
        return;
    }

    const start = map.latLngToLayerPoint(line.startPoint.latlng);
    const end = map.latLngToLayerPoint(line.endPoint.latlng);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    const flipped = rawAngle > 90 || rawAngle < -90;
    const angle = flipped
        ? rawAngle + (rawAngle > 90 ? -180 : 180)
        : rawAngle;
    const midpoint = map.layerPointToLatLng(
        L.point((start.x + end.x) / 2, (start.y + end.y) / 2)
    );

    line.annotation.setLatLng(midpoint);
    line.annotation.setIcon(lineAnnotationIcon(line, angle, flipped));
}

function updateLineAnnotations() {
    navigationLines.concat(bearingLines).forEach(updateLineAnnotation);
    intercepts.forEach(renderIntercept);
}

map.on("moveend", updateLineAnnotations);
map.on("zoomend", updateLineAnnotations);
map.on("resize", updateLineAnnotations);

function createPoint(type, latlng, label, id) {
    const point = {
        id: id || "point-" + nextPointId++,
        type,
        label,
        latlng,
        marker: null,
        incomingLine: null
    };
    const isFix = type === "FIX";
    point.marker = L.marker(latlng, {
        draggable: isFix,
        bubblingMouseEvents: false,
        title: isFix ? "Drag to move FIX" : "Derived DR point",
        alt: label,
        icon: pointIcon(point, false)
    }).addTo(map);
    point.marker.on("click", () => selectObject(point));
    if (isFix) {
        point.marker.on("drag", () => {
            point.latlng = point.marker.getLatLng();
            navigationLines
                .filter(line => line.startPoint === point)
                .forEach(line => updateLineAndDescendants(line, false));
            bearingLines
                .filter(line => line.fixPoint === point)
                .forEach(line => updateBearingLine(line, false));
            intercepts
                .filter(intercept => intercept.apPoint === point)
                .forEach(intercept => renderIntercept(intercept));
            updateGreatCircleRoutesForPoint(point);
        });
        point.marker.on("dragend", () => {
            point.marker.setIcon(pointIcon(point, point === selectedObject));
            refreshLineLabelsFromPoint(point);
            bearingLines
                .filter(line => line.fixPoint === point)
                .forEach(updateLineAnnotation);
            intercepts
                .filter(intercept => intercept.apPoint === point)
                .forEach(intercept => updateInterceptAnnotations(intercept));
            if (selectedObject === point) {
                showPointInfo(point);
            }
            persistNavigationState();
        });
    }
    points.push(point);
    objects.push(point.marker);
    return point;
}

function createDrLine(startPoint, bearingDegrees, distanceNM, options = {}) {
    const endPointLabel = options.endPointLabel || "DR " + nextDrNumber++;
    const endPoint = createPoint(
        "DR",
        destinationPoint(startPoint.latlng, bearingDegrees, distanceNM),
        endPointLabel,
        options.endPointId
    );
    const line = {
        id: options.id || "line-" + nextLineId++,
        startPoint,
        endPoint,
        bearing: bearingDegrees,
        distanceNM,
        layer: L.polyline(
            [startPoint.latlng, endPoint.latlng],
            { color: "red", weight: 3, bubblingMouseEvents: false }
        ).addTo(map)
    };
    line.annotation = L.marker(startPoint.latlng, {
        icon: L.divIcon({
            className: "line-annotation-icon",
            html: "",
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        }),
        interactive: false,
        keyboard: false,
        bubblingMouseEvents: false
    }).addTo(map);
    endPoint.incomingLine = line;
    line.layer.on("click", () => selectObject(line));
    navigationLines.push(line);
    objects.push(line.layer);
    objects.push(line.annotation);
    updateLineAnnotation(line);
    if (options.selectEndPoint !== false) {
        selectObject(endPoint);
    }
    persistNavigationState();
    return line;
}

function createBearingLine(fixPoint, bearingDegrees, distanceNM, options = {}) {
    const startPoint = {
        latlng: destinationPoint(
            fixPoint.latlng,
            (bearingDegrees + 180) % 360,
            distanceNM
        )
    };
    const line = {
        id: options.id || "line-" + nextLineId++,
        fixPoint,
        startPoint,
        endPoint: fixPoint,
        bearing: bearingDegrees,
        distanceNM,
        layer: L.polyline(
            [startPoint.latlng, fixPoint.latlng],
            {
                color: "#555",
                weight: 3,
                dashArray: "6, 6",
                bubblingMouseEvents: false
            }
        ).addTo(map),
        handle: null,
        annotation: null
    };
    line.handle = L.marker(startPoint.latlng, {
        draggable: true,
        zIndexOffset: 1000,
        bubblingMouseEvents: false,
        title: "Drag to change BRG TO length",
        icon: L.divIcon({
            className: "navigation-bearing-handle",
            html: "",
            iconSize: [8, 8],
            iconAnchor: [4, 4]
        })
    }).addTo(map);
    line.annotation = L.marker(startPoint.latlng, {
        icon: L.divIcon({
            className: "line-annotation-icon",
            html: "",
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        }),
        interactive: false,
        keyboard: false,
        bubblingMouseEvents: false
    }).addTo(map);
    line.layer.on("click", () => selectObject(line));
    line.handle.on("click", () => selectObject(line));
    line.handle.on("drag", () => {
        const draggedPosition = line.handle.getLatLng();
        line.distanceNM = Math.max(
            distanceNMBetween(draggedPosition, fixPoint.latlng),
            0.001
        );
        updateBearingLine(line);
    });
    line.handle.on("dragend", () => {
        if (selectedObject === line) {
            showLineInfo(line);
        }
        persistNavigationState();
    });
    bearingLines.push(line);
    objects.push(line.layer, line.handle, line.annotation);
    updateLineAnnotation(line);
    return line;
}

function interceptLineAnnotationIcon(bearing, suffix, angle, flipped) {
    const sideClass = flipped ? " line-annotation-flipped" : "";
    return L.divIcon({
        className: "intercept-line-annotation-icon",
        html:
            '<span class="line-annotation-content' +
            sideClass +
            '" style="transform: translate(-50%, -50%) rotate(' +
            angle.toFixed(2) +
            'deg)"><span class="line-annotation-bearing">' +
            String(Math.round(bearing) % 360).padStart(3, "0") +
            '°</span><span class="line-annotation-distance">' +
            suffix +
            "</span></span>",
        iconSize: [0, 0],
        iconAnchor: [0, 0]
    });
}

function updateInterceptAnnotation(marker, start, end, bearing, suffix) {
    const startPoint = map.latLngToLayerPoint(start);
    const endPoint = map.latLngToLayerPoint(end);
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    const flipped = rawAngle > 90 || rawAngle < -90;
    const angle = flipped
        ? rawAngle + (rawAngle > 90 ? -180 : 180)
        : rawAngle;
    marker.setLatLng(map.layerPointToLatLng(
        L.point((startPoint.x + endPoint.x) / 2, (startPoint.y + endPoint.y) / 2)
    ));
    marker.setIcon(interceptLineAnnotationIcon(bearing, suffix, angle, flipped));
}

function updateInterceptAnnotations(intercept) {
    const arrowEnd = destinationPoint(
        intercept.apPoint.latlng,
        intercept.bearing,
        intercept.arrowLengthNM
    );
    if (intercept.interceptNM >= 0) {
        updateInterceptAnnotation(
            intercept.arrowAnnotation,
            intercept.apPoint.latlng,
            arrowEnd,
            intercept.bearing,
            intercept.interceptNM.toFixed(1) + " nm TOWARDS"
        );
    } else if (intercept.awayLayer) {
        const awayEnd = destinationPoint(
            intercept.apPoint.latlng,
            (intercept.bearing + 180) % 360,
            intercept.awayLengthNM
        );
        updateInterceptAnnotation(
            intercept.arrowAnnotation,
            intercept.apPoint.latlng,
            awayEnd,
            intercept.bearing,
            Math.abs(intercept.interceptNM).toFixed(1) + " nm AWAY"
        );
    }
}

function updateInterceptLopAnnotation(intercept, lopStart, lopEnd) {
    const startPoint = map.latLngToLayerPoint(lopStart);
    const endPoint = map.latLngToLayerPoint(lopEnd);
    const startScore = startPoint.x + startPoint.y;
    const endScore = endPoint.x + endPoint.y;
    const labelEnd = startScore <= endScore ? startPoint : endPoint;
    const midpoint = L.point(
        (startPoint.x + endPoint.x) / 2,
        (startPoint.y + endPoint.y) / 2
    );
    const dx = labelEnd.x - midpoint.x;
    const dy = labelEnd.y - midpoint.y;
    const rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    const flipped = rawAngle > 90 || rawAngle < -90;
    const angle = flipped
        ? rawAngle + (rawAngle > 90 ? -180 : 180)
        : rawAngle;
    intercept.lopAnnotation.setLatLng(map.layerPointToLatLng(L.point(
        (labelEnd.x + midpoint.x) / 2,
        (labelEnd.y + midpoint.y) / 2
    )));
    intercept.lopAnnotation.setIcon(L.divIcon({
        className: "intercept-lop-label-icon",
        html:
            '<span class="line-annotation-content' +
            (flipped ? " line-annotation-flipped" : "") +
            '" style="transform: translate(-50%, -50%) rotate(' +
            angle.toFixed(2) +
            'deg)"><span class="intercept-lop-label">LOP: ' +
            escapeHtml(intercept.starName) +
            "</span></span>",
        iconSize: [0, 0],
        iconAnchor: [0, 0]
    }));
}

function renderIntercept(intercept) {
    ensureInterceptAwayLayer(intercept);
    const apPosition = intercept.apPoint.latlng;
    const arrowEnd = destinationPoint(
        apPosition,
        intercept.bearing,
        intercept.arrowLengthNM
    );
    intercept.arrowLayer.setLatLngs([apPosition, arrowEnd]);
    intercept.arrowHandle.setLatLng(arrowEnd);
    intercept.starMarker.setLatLng(arrowEnd);
    intercept.arrowheadMarker.setLatLng(destinationPoint(
        apPosition,
        intercept.bearing,
        Math.max(0.05, intercept.arrowLengthNM - 0.35)
    ));
    intercept.arrowheadMarker.setIcon(L.divIcon({
        className: "intercept-arrowhead-icon",
        html:
            '<span class="intercept-arrowhead" style="transform: rotate(' +
            intercept.bearing +
            'deg)">▲</span>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    }));

    if (intercept.awayLayer) {
        const awayEnd = destinationPoint(
            apPosition,
            (intercept.bearing + 180) % 360,
            intercept.awayLengthNM
        );
        intercept.awayLayer.setLatLngs([apPosition, awayEnd]);
    }

    const lopCenter = destinationPoint(
        apPosition,
        (intercept.bearing + (intercept.interceptNM < 0 ? 180 : 0)) % 360,
        Math.abs(intercept.interceptNM)
    );
    const lopStart = destinationPoint(
        lopCenter,
        (intercept.bearing + 90) % 360,
        intercept.lopPositiveNM
    );
    const lopEnd = destinationPoint(
        lopCenter,
        (intercept.bearing + 270) % 360,
        intercept.lopNegativeNM
    );
    intercept.lopLayer.setLatLngs([lopStart, lopEnd]);
    intercept.lopHandles[0].setLatLng(lopStart);
    intercept.lopHandles[1].setLatLng(lopEnd);
    updateInterceptLopAnnotation(intercept, lopStart, lopEnd);
    updateInterceptAnnotations(intercept);
    intercept.starMarker.setIcon(L.divIcon({
        className: "intercept-star-icon",
        html:
            '<span class="intercept-star">★<span class="intercept-star-label">' +
            escapeHtml(intercept.starName) +
            "</span></span>",
        iconSize: [40, 34],
        iconAnchor: [20, 12]
    }));
}

function makeInterceptMarker(latlng, className, html, iconSize, iconAnchor, options = {}) {
    return L.marker(latlng, {
        icon: L.divIcon({
            className,
            html,
            iconSize,
            iconAnchor
        }),
        interactive: false,
        keyboard: false,
        bubblingMouseEvents: false,
        ...options
    }).addTo(map);
}

function ensureInterceptAwayLayer(intercept) {
    if (intercept.interceptNM < 0 && !intercept.awayLayer) {
        intercept.awayLayer = L.polyline([], {
            color: "#666",
            weight: 3,
            dashArray: "6, 6",
            bubblingMouseEvents: false
        }).addTo(map);
        intercept.awayLayer.on("click", () => selectObject(intercept));
        objects.push(intercept.awayLayer);
    } else if (intercept.interceptNM >= 0 && intercept.awayLayer) {
        map.removeLayer(intercept.awayLayer);
        objects = objects.filter(object => object !== intercept.awayLayer);
        intercept.awayLayer = null;
    }
}

function createIntercept(apPoint, starName, bearing, interceptNM, options = {}) {
    const intercept = {
        id: options.id || "line-" + nextLineId++,
        apPoint,
        starName,
        bearing,
        interceptNM,
        arrowLengthNM: Number.isFinite(options.arrowLengthNM)
            ? options.arrowLengthNM
            :
            (interceptNM > 0 ? interceptNM + 1 : 1.5),
        awayLengthNM: Number.isFinite(options.awayLengthNM)
            ? options.awayLengthNM
            : Math.abs(interceptNM) + 1,
        lopPositiveNM: Number.isFinite(options.lopPositiveNM)
            ? options.lopPositiveNM
            : 1,
        lopNegativeNM: Number.isFinite(options.lopNegativeNM)
            ? options.lopNegativeNM
            : 1,
        arrowLayer: null,
        awayLayer: null,
        lopLayer: null,
        arrowHandle: null,
        lopHandles: [],
        starMarker: null,
        arrowheadMarker: null,
        arrowAnnotation: null,
        lopAnnotation: null
    };
    const apPosition = apPoint.latlng;
    const arrowEnd = destinationPoint(
        apPosition,
        bearing,
        intercept.arrowLengthNM
    );
    const arrowStyle = {
        color: "#666",
        weight: 3,
        dashArray: "6, 6",
        bubblingMouseEvents: false
    };
    const lopStyle = {
        color: "#666",
        weight: 3,
        bubblingMouseEvents: false
    };
    intercept.arrowLayer = L.polyline(
        [apPosition, arrowEnd],
        arrowStyle
    ).addTo(map);
    if (interceptNM < 0) {
        intercept.awayLayer = L.polyline(
            [
                apPosition,
                destinationPoint(apPosition, (bearing + 180) % 360, intercept.awayLengthNM)
            ],
            arrowStyle
        ).addTo(map);
    }
    intercept.lopLayer = L.polyline([], lopStyle).addTo(map);
    intercept.arrowHandle = L.marker(arrowEnd, {
        draggable: true,
        zIndexOffset: 1000,
        bubblingMouseEvents: false,
        title: "Drag to change intercept arrow length",
        icon: L.divIcon({
            className: "intercept-arrow-handle",
            html: "",
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        })
    }).addTo(map);
    intercept.lopHandles = [0, 1].map(index =>
        L.marker(apPosition, {
            draggable: true,
            zIndexOffset: 1000,
            bubblingMouseEvents: false,
            title: "Drag to change LOP length on this side",
            icon: L.divIcon({
                className: "intercept-lop-handle",
                html: "",
                iconSize: [8, 8],
                iconAnchor: [4, 4]
            })
        }).addTo(map)
    );
    intercept.starMarker = makeInterceptMarker(
        arrowEnd,
        "intercept-star-icon",
        '<span class="intercept-star">★<span class="intercept-star-label">' +
            escapeHtml(starName) +
            "</span></span>",
        [40, 34],
        [20, 12],
        { zIndexOffset: 900 }
    );
    intercept.arrowheadMarker = makeInterceptMarker(
        arrowEnd,
        "intercept-arrowhead-icon",
        "",
        [12, 12],
        [6, 6],
        { zIndexOffset: 800 }
    );
    intercept.arrowAnnotation = makeInterceptMarker(
        arrowEnd,
        "intercept-line-annotation-icon",
        "",
        [0, 0],
        [0, 0]
    );
    intercept.lopAnnotation = makeInterceptMarker(
        apPosition,
        "intercept-lop-label-icon",
        "",
        [0, 0],
        [0, 0]
    );

    const selectIntercept = () => selectObject(intercept);
    [intercept.arrowLayer, intercept.awayLayer, intercept.lopLayer]
        .filter(Boolean)
        .forEach(layer => layer.on("click", selectIntercept));
    [intercept.arrowHandle, ...intercept.lopHandles]
        .forEach(handle => handle.on("click", selectIntercept));
    intercept.arrowHandle.on("drag", () => {
        intercept.arrowLengthNM = Math.max(
            distanceNMBetween(
                intercept.apPoint.latlng,
                intercept.arrowHandle.getLatLng()
            ),
            0.1
        );
        renderIntercept(intercept);
    });
    intercept.arrowHandle.on("dragend", () => {
        if (selectedObject === intercept) {
            showInterceptInfo(intercept);
        }
        persistNavigationState();
    });
    intercept.lopHandles.forEach((handle, index) => {
        handle.on("drag", () => {
            const center = destinationPoint(
                intercept.apPoint.latlng,
                (intercept.bearing + (intercept.interceptNM < 0 ? 180 : 0)) % 360,
                Math.abs(intercept.interceptNM)
            );
            intercept[index === 0 ? "lopPositiveNM" : "lopNegativeNM"] =
                Math.max(distanceNMBetween(center, handle.getLatLng()), 0.05);
            renderIntercept(intercept);
        });
        handle.on("dragend", () => {
            if (selectedObject === intercept) {
                showInterceptInfo(intercept);
            }
            persistNavigationState();
        });
    });

    intercepts.push(intercept);
    objects.push(...[
        intercept.arrowLayer,
        intercept.awayLayer,
        intercept.lopLayer,
        intercept.arrowHandle,
        ...intercept.lopHandles,
        intercept.starMarker,
        intercept.arrowheadMarker,
        intercept.arrowAnnotation,
        intercept.lopAnnotation
    ].filter(Boolean));
    renderIntercept(intercept);
    return intercept;
}

function createGreatCircleRoute(startPoint, endPoint, id) {
    const route = {
        id: id || "line-" + nextLineId++,
        startPoint,
        endPoint,
        layer: L.polyline(
            greatCirclePath(startPoint.latlng, endPoint.latlng),
            { color: "#003366", weight: 3, bubblingMouseEvents: false }
        ).addTo(map)
    };
    route.layer.on("click", () => selectObject(route));
    greatCircleRoutes.push(route);
    objects.push(route.layer);
    return route;
}

function showStorageError(action, error) {
    const detail = error && error.message ? ": " + error.message : "";
    console.error("Navigation data " + action + " failed", error);
    setInfoMessage("Navigation data " + action + " failed" + detail);
}

function serializeNavigationState() {
    return {
        version: 1,
        nextFixNumber,
        nextDrNumber,
        nextPointId,
        nextLineId,
        points: points.map(point => ({
            id: point.id,
            type: point.type,
            label: point.label,
            lat: point.latlng.lat,
            lng: point.latlng.lng
        })),
        lines: navigationLines.map(line => ({
            id: line.id,
            startPointId: line.startPoint.id,
            endPointId: line.endPoint.id,
            bearing: line.bearing,
            distanceNM: line.distanceNM
        })),
        bearingLines: bearingLines.map(line => ({
            id: line.id,
            fixPointId: line.fixPoint.id,
            bearing: line.bearing,
            distanceNM: line.distanceNM
        })),
        intercepts: intercepts.map(intercept => ({
            id: intercept.id,
            apPointId: intercept.apPoint.id,
            starName: intercept.starName,
            bearing: intercept.bearing,
            interceptNM: intercept.interceptNM,
            arrowLengthNM: intercept.arrowLengthNM,
            awayLengthNM: intercept.awayLengthNM,
            lopPositiveNM: intercept.lopPositiveNM,
            lopNegativeNM: intercept.lopNegativeNM
        })),
        greatCircleRoutes: greatCircleRoutes.map(route => ({
            id: route.id,
            startPointId: route.startPoint.id,
            endPointId: route.endPoint.id
        }))
    };
}

function persistNavigationState() {
    if (isRestoringNavigationState) {
        return;
    }
    try {
        window.localStorage.setItem(
            navigationStorageKey,
            JSON.stringify(serializeNavigationState())
        );
    } catch (error) {
        showStorageError("save", error);
    }
}

function persistMapViewport() {
    const center = map.getCenter();
    const viewport = {
        lat: center.lat,
        lng: center.lng,
        zoom: map.getZoom()
    };
    try {
        window.localStorage.setItem(
            viewportStorageKey,
            JSON.stringify(viewport)
        );
    } catch (error) {
        showStorageError("save map viewport", error);
    }
}

map.on("moveend", persistMapViewport);
map.on("zoomend", persistMapViewport);

function validateStoredNavigationState(state) {
    const invalid = message => {
        throw new Error("Saved navigation data is invalid: " + message);
    };
    if (
        !state ||
        state.version !== 1 ||
        !Array.isArray(state.points) ||
        !Array.isArray(state.lines) ||
        (state.bearingLines !== undefined &&
            !Array.isArray(state.bearingLines)) ||
        (state.intercepts !== undefined &&
            !Array.isArray(state.intercepts)) ||
        (state.greatCircleRoutes !== undefined &&
            !Array.isArray(state.greatCircleRoutes)) ||
        !Number.isInteger(state.nextFixNumber) ||
        state.nextFixNumber < 1 ||
        !Number.isInteger(state.nextDrNumber) ||
        state.nextDrNumber < 1 ||
        !Number.isInteger(state.nextPointId) ||
        state.nextPointId < 1 ||
        !Number.isInteger(state.nextLineId) ||
        state.nextLineId < 1
    ) {
        invalid("unsupported format or counters");
    }

    const pointsById = new Map();
    let highestPointId = 0;
    state.points.forEach(point => {
        const pointIdMatch = point && /^point-(\d+)$/.exec(point.id);
        if (
            !pointIdMatch ||
            pointsById.has(point.id) ||
            !["FIX", "DR"].includes(point.type) ||
            typeof point.label !== "string" ||
            !point.label.trim() ||
            !Number.isFinite(point.lat) ||
            point.lat < -90 ||
            point.lat > 90 ||
            !Number.isFinite(point.lng) ||
            point.lng < -180 ||
            point.lng > 180
        ) {
            invalid("point record");
        }
        highestPointId = Math.max(highestPointId, Number(pointIdMatch[1]));
        pointsById.set(point.id, point);
    });
    if (state.nextPointId <= highestPointId) {
        invalid("point counter");
    }

    const lineIds = new Set();
    const incomingCounts = new Map();
    let highestLineId = 0;
    state.lines.forEach(line => {
        const lineIdMatch = line && /^line-(\d+)$/.exec(line.id);
        const startPoint = line && pointsById.get(line.startPointId);
        const endPoint = line && pointsById.get(line.endPointId);
        if (
            !lineIdMatch ||
            lineIds.has(line.id) ||
            !startPoint ||
            !endPoint ||
            endPoint.type !== "DR" ||
            !Number.isFinite(line.bearing) ||
            line.bearing < 0 ||
            line.bearing >= 360 ||
            !Number.isFinite(line.distanceNM) ||
            line.distanceNM <= 0
        ) {
            invalid("line record");
        }
        highestLineId = Math.max(highestLineId, Number(lineIdMatch[1]));
        lineIds.add(line.id);
        incomingCounts.set(
            line.endPointId,
            (incomingCounts.get(line.endPointId) || 0) + 1
        );
    });
    pointsById.forEach(point => {
        const incomingCount = incomingCounts.get(point.id) || 0;
        if ((point.type === "FIX" && incomingCount !== 0) ||
            (point.type === "DR" && incomingCount !== 1)) {
            invalid("point-to-line relationships");
        }
    });

    const reachablePoints = new Set(
        state.points.filter(point => point.type === "FIX").map(point => point.id)
    );
    const pendingLines = state.lines.slice();
    let previousCount = -1;
    while (pendingLines.length && pendingLines.length !== previousCount) {
        previousCount = pendingLines.length;
        for (let index = pendingLines.length - 1; index >= 0; index -= 1) {
            const line = pendingLines[index];
            if (reachablePoints.has(line.startPointId)) {
                reachablePoints.add(line.endPointId);
                pendingLines.splice(index, 1);
            }
        }
    }
    if (pendingLines.length || reachablePoints.size !== pointsById.size) {
        invalid("cyclic or disconnected route");
    }
    (state.greatCircleRoutes || []).forEach(route => {
        const routeIdMatch = route && /^line-(\d+)$/.exec(route.id);
        const startPoint = route && pointsById.get(route.startPointId);
        const endPoint = route && pointsById.get(route.endPointId);
        if (
            !routeIdMatch ||
            lineIds.has(route.id) ||
            !startPoint ||
            !endPoint ||
            startPoint.type !== "FIX" ||
            endPoint.type !== "FIX"
        ) {
            invalid("great circle route record");
        }
        highestLineId = Math.max(highestLineId, Number(routeIdMatch[1]));
        lineIds.add(route.id);
    });
    (state.bearingLines || []).forEach(line => {
        const lineIdMatch = line && /^line-(\d+)$/.exec(line.id);
        const fixPoint = line && pointsById.get(line.fixPointId);
        if (
            !lineIdMatch ||
            lineIds.has(line.id) ||
            !fixPoint ||
            fixPoint.type !== "FIX" ||
            !Number.isFinite(line.bearing) ||
            line.bearing < 0 ||
            line.bearing >= 360 ||
            !Number.isFinite(line.distanceNM) ||
            line.distanceNM <= 0
        ) {
            invalid("BRG TO line record");
        }
        highestLineId = Math.max(highestLineId, Number(lineIdMatch[1]));
        lineIds.add(line.id);
    });
    (state.intercepts || []).forEach(intercept => {
        const interceptIdMatch = intercept && /^line-(\d+)$/.exec(intercept.id);
        const apPoint = intercept && pointsById.get(intercept.apPointId);
        if (
            !interceptIdMatch ||
            lineIds.has(intercept.id) ||
            !apPoint ||
            apPoint.type !== "FIX" ||
            typeof intercept.starName !== "string" ||
            !intercept.starName.trim() ||
            !Number.isFinite(intercept.bearing) ||
            intercept.bearing < 0 ||
            intercept.bearing >= 360 ||
            !Number.isFinite(intercept.interceptNM) ||
            !Number.isFinite(intercept.arrowLengthNM) ||
            intercept.arrowLengthNM <= 0 ||
            !Number.isFinite(intercept.awayLengthNM) ||
            intercept.awayLengthNM <= 0 ||
            !Number.isFinite(intercept.lopPositiveNM) ||
            intercept.lopPositiveNM <= 0 ||
            !Number.isFinite(intercept.lopNegativeNM) ||
            intercept.lopNegativeNM <= 0
        ) {
            invalid("INT record");
        }
        highestLineId = Math.max(highestLineId, Number(interceptIdMatch[1]));
        lineIds.add(intercept.id);
    });
    if (state.nextLineId <= highestLineId) {
        invalid("line counter");
    }
    return pointsById;
}

function restoreNavigationState() {
    let serialized;
    try {
        serialized = window.localStorage.getItem(navigationStorageKey);
    } catch (error) {
        showStorageError("load", error);
        return;
    }
    if (serialized === null) {
        return;
    }

    let state;
    try {
        state = JSON.parse(serialized);
        validateStoredNavigationState(state);
    } catch (error) {
        showStorageError("load", error);
        return;
    }

    isRestoringNavigationState = true;
    try {
        nextFixNumber = state.nextFixNumber;
        nextDrNumber = state.nextDrNumber;
        nextPointId = state.nextPointId;
        nextLineId = state.nextLineId;
        const restoredPoints = new Map();
        state.points
            .filter(point => point.type === "FIX")
            .forEach(point => {
                restoredPoints.set(
                    point.id,
                    createPoint("FIX", { lat: point.lat, lng: point.lng }, point.label, point.id)
                );
            });

        const pendingLines = state.lines.slice();
        while (pendingLines.length) {
            const readyIndex = pendingLines.findIndex(line =>
                restoredPoints.has(line.startPointId)
            );
            const savedLine = pendingLines.splice(readyIndex, 1)[0];
            const endPointData = state.points.find(
                point => point.id === savedLine.endPointId
            );
            const line = createDrLine(
                restoredPoints.get(savedLine.startPointId),
                savedLine.bearing,
                savedLine.distanceNM,
                {
                    id: savedLine.id,
                    endPointId: endPointData.id,
                    endPointLabel: endPointData.label,
                    selectEndPoint: false
                }
            );
            restoredPoints.set(endPointData.id, line.endPoint);
        }
        (state.greatCircleRoutes || []).forEach(route => {
            createGreatCircleRoute(
                restoredPoints.get(route.startPointId),
                restoredPoints.get(route.endPointId),
                route.id
            );
        });
        (state.bearingLines || []).forEach(line => {
            createBearingLine(
                restoredPoints.get(line.fixPointId),
                line.bearing,
                line.distanceNM,
                { id: line.id }
            );
        });
        (state.intercepts || []).forEach(intercept => {
            createIntercept(
                restoredPoints.get(intercept.apPointId),
                intercept.starName,
                intercept.bearing,
                intercept.interceptNM,
                {
                    id: intercept.id,
                    arrowLengthNM: intercept.arrowLengthNM,
                    awayLengthNM: intercept.awayLengthNM,
                    lopPositiveNM: intercept.lopPositiveNM,
                    lopNegativeNM: intercept.lopNegativeNM
                }
            );
        });
        updateSelectionStyle();
    } catch (error) {
        showStorageError("restore", error);
    } finally {
        isRestoringNavigationState = false;
    }
}

function activateButton(id) {
    document
        .querySelectorAll(".toolbar button")
        .forEach(button => button.classList.remove("active"));
    if (id) {
        document.getElementById(id).classList.add("active");
    }
}

const menuToggle = document.getElementById("menuToggle");
const toolbarActions = document.getElementById("toolbarActions");
menuToggle.onclick = () => {
    const expanded = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!expanded));
    menuToggle.querySelector("span").textContent = expanded ? "+" : "−";
    toolbarActions.hidden = expanded;
};
document.getElementById("infoClose").onclick = () => {
    document.getElementById("info").hidden = true;
};

function openDrPopup() {
    if (!points.includes(selectedObject)) {
        return;
    }
    mode = null;
    activateButton("drTool");
    drStartLabel.textContent = selectedObject.label;
    drBearing.value = "";
    drDistance.value = "";
    drError.textContent = "";
    drPopup.hidden = false;
    drBearing.focus();
}

function closeDrPopup() {
    drPopup.hidden = true;
    drError.textContent = "";
    activateButton(null);
}

function openBearingPopup() {
    if (
        !points.includes(selectedObject) ||
        selectedObject.type !== "FIX"
    ) {
        return;
    }
    mode = null;
    activateButton("brgToTool");
    brgToFixLabel.textContent = selectedObject.label;
    brgToBearing.value = "";
    brgToError.textContent = "";
    brgToPopup.hidden = false;
    brgToBearing.focus();
}

function closeBearingPopup() {
    brgToPopup.hidden = true;
    brgToError.textContent = "";
    activateButton(null);
}

function openInterceptPopup() {
    if (!points.includes(selectedObject) || selectedObject.type !== "FIX") {
        return;
    }
    mode = null;
    activateButton("intTool");
    intFixLabel.textContent = selectedObject.label;
    intName.value = "";
    intBearing.value = "";
    intDistance.value = "";
    intError.textContent = "";
    intPopup.hidden = false;
    intName.focus();
}

function closeInterceptPopup() {
    intPopup.hidden = true;
    intError.textContent = "";
    activateButton(null);
}

function applyPointEdits(event) {
    event.preventDefault();
    if (!points.includes(selectedObject)) {
        return;
    }

    const label = pointLabel.value.trim();
    const position = parsePosition(pointPosition.value);
    if (
        !label ||
        (selectedObject.type === "FIX" && !position)
    ) {
        infoMessage.textContent =
            "Enter a label and position in the format N 54° 10.12' - E 10° 12.34'.";
        return;
    }

    selectedObject.label = label;
    if (selectedObject.type === "FIX") {
        selectedObject.latlng = position;
        selectedObject.marker.setLatLng(selectedObject.latlng);
        navigationLines
            .filter(line => line.startPoint === selectedObject)
            .forEach(updateLineAndDescendants);
        bearingLines
            .filter(line => line.fixPoint === selectedObject)
            .forEach(updateBearingLine);
        intercepts
            .filter(intercept => intercept.apPoint === selectedObject)
            .forEach(intercept => renderIntercept(intercept));
        updateGreatCircleRoutesForPoint(selectedObject);
    }
    selectedObject.marker.setIcon(pointIcon(selectedObject, true));
    showPointInfo(selectedObject);
    persistNavigationState();
}

function applyInterceptEdits(event) {
    event.preventDefault();
    if (!intercepts.includes(selectedObject)) {
        return;
    }
    const starName = interceptName.value.trim();
    const bearing = Number(interceptBearing.value);
    const distance = Number(interceptDistance.value);
    const distanceChanged = distance !== selectedObject.interceptNM;
    if (
        !starName ||
        interceptBearing.value.trim() === "" ||
        interceptDistance.value.trim() === "" ||
        !Number.isFinite(bearing) ||
        bearing < 0 ||
        bearing > 360 ||
        !Number.isFinite(distance)
    ) {
        infoMessage.textContent =
            "Enter a star name, bearing from 0° to 360°, and a numeric intercept distance.";
        return;
    }
    selectedObject.starName = starName;
    selectedObject.bearing = bearing % 360;
    selectedObject.interceptNM = distance;
    if (distanceChanged) {
        selectedObject.arrowLengthNM =
            distance > 0 ? distance + 1 : 1.5;
        selectedObject.awayLengthNM = Math.abs(distance) + 1;
    }
    renderIntercept(selectedObject);
    updateSelectionStyle();
    showInterceptInfo(selectedObject);
    persistNavigationState();
}

function applyLineEdits(event) {
    event.preventDefault();
    if (
        !navigationLines.includes(selectedObject) &&
        !bearingLines.includes(selectedObject)
    ) {
        return;
    }

    const bearingDegrees = Number(lineBearing.value);
    const distance = Number(lineDistance.value);
    if (
        lineBearing.value.trim() === "" ||
        lineDistance.value.trim() === "" ||
        !Number.isFinite(bearingDegrees) ||
        bearingDegrees < 0 ||
        bearingDegrees > 360 ||
        !Number.isFinite(distance) ||
        distance <= 0
    ) {
        infoMessage.textContent = "Enter a bearing from 0° to 360° and a positive distance.";
        return;
    }

    selectedObject.bearing = bearingDegrees % 360;
    selectedObject.distanceNM = distance;
    if (bearingLines.includes(selectedObject)) {
        updateBearingLine(selectedObject);
    } else {
        updateLineAndDescendants(selectedObject);
    }
    showLineInfo(selectedObject);
    persistNavigationState();
}

function collectDescendantLines(point, result) {
    navigationLines
        .filter(line => line.startPoint === point && !result.has(line))
        .forEach(line => {
            result.add(line);
            collectDescendantLines(line.endPoint, result);
        });
}

function interceptLayers(intercept) {
    return [
        intercept.arrowLayer,
        intercept.awayLayer,
        intercept.lopLayer,
        intercept.arrowHandle,
        ...intercept.lopHandles,
        intercept.starMarker,
        intercept.arrowheadMarker,
        intercept.arrowAnnotation,
        intercept.lopAnnotation
    ].filter(Boolean);
}

function deleteSelectedObject() {
    if (!selectedObject) {
        return;
    }
    const selectedLine = navigationLines.includes(selectedObject)
        ? selectedObject
        : null;
    const selectedBearingLine = bearingLines.includes(selectedObject)
        ? selectedObject
        : null;
    const selectedIntercept = intercepts.includes(selectedObject)
        ? selectedObject
        : null;
    const selectedGreatCircleRoute = greatCircleRoutes.includes(selectedObject)
        ? selectedObject
        : null;
    const selectedPoint = points.includes(selectedObject)
        ? selectedObject
        : null;
    if (selectedIntercept) {
        if (!window.confirm("Delete all INT lines and the star for " + selectedIntercept.starName + "?")) {
            return;
        }
        const removedLayers = new Set(interceptLayers(selectedIntercept));
        removedLayers.forEach(layer => map.removeLayer(layer));
        objects = objects.filter(object => !removedLayers.has(object));
        intercepts = intercepts.filter(intercept => intercept !== selectedIntercept);
        selectedObject = null;
        updateSelectionStyle();
        setInfoMessage("INT lines deleted");
        persistNavigationState();
        return;
    }
    if (selectedBearingLine) {
        if (!window.confirm("Delete the selected BRG TO line?")) {
            return;
        }
        map.removeLayer(selectedBearingLine.layer);
        map.removeLayer(selectedBearingLine.annotation);
        map.removeLayer(selectedBearingLine.handle);
        const removedLayers = new Set([
            selectedBearingLine.layer,
            selectedBearingLine.annotation,
            selectedBearingLine.handle
        ]);
        objects = objects.filter(object => !removedLayers.has(object));
        bearingLines = bearingLines.filter(line => line !== selectedBearingLine);
        selectedObject = null;
        updateSelectionStyle();
        setInfoMessage("BRG TO line deleted");
        persistNavigationState();
        return;
    }
    const affectedLines = new Set();
    const affectedPoints = new Set();
    if (selectedGreatCircleRoute) {
        if (!window.confirm("Delete the selected Great Circle Route?")) {
            return;
        }
        map.removeLayer(selectedGreatCircleRoute.layer);
        objects = objects.filter(object => object !== selectedGreatCircleRoute.layer);
        greatCircleRoutes = greatCircleRoutes.filter(
            route => route !== selectedGreatCircleRoute
        );
        selectedObject = null;
        updateSelectionStyle();
        setInfoMessage("Great Circle Route deleted");
        persistNavigationState();
        return;
    } else if (selectedLine) {
        affectedLines.add(selectedLine);
        affectedPoints.add(selectedLine.endPoint);
        collectDescendantLines(selectedLine.endPoint, affectedLines);
    } else if (selectedPoint) {
        affectedPoints.add(selectedPoint);
        if (selectedPoint.incomingLine) {
            affectedLines.add(selectedPoint.incomingLine);
        }
        collectDescendantLines(selectedPoint, affectedLines);
    } else {
        return;
    }
    affectedLines.forEach(line => affectedPoints.add(line.endPoint));
    const affectedGreatCircleRoutes = new Set(
        greatCircleRoutes.filter(route =>
            affectedPoints.has(route.startPoint) ||
            affectedPoints.has(route.endPoint)
        )
    );
    const affectedBearingLines = new Set(
        bearingLines.filter(line => affectedPoints.has(line.fixPoint))
    );
    const affectedIntercepts = new Set(
        intercepts.filter(intercept => affectedPoints.has(intercept.apPoint))
    );

    const cascades = affectedPoints.size > 1 || affectedLines.size > 1;
    let message;
    if (
        selectedPoint &&
        selectedPoint.type === "FIX" &&
        (affectedBearingLines.size || affectedIntercepts.size)
    ) {
        message = "Delete the selected FIX";
        if (affectedBearingLines.size) {
            message += " and its " + affectedBearingLines.size +
                " attached BRG TO line(s)";
        }
        if (affectedIntercepts.size) {
            message += (affectedBearingLines.size ? ", plus " : " and its ") +
                affectedIntercepts.size + " attached INT sight(s)";
        }
        if (cascades) {
            message += ", plus " + (affectedPoints.size - 1) +
                " dependent DR point(s) and their lines";
        }
        message += "?";
    } else if (cascades) {
        message = "Delete this object and " +
            (affectedPoints.size - (selectedPoint ? 1 : 0)) +
            " dependent DR point(s) and their lines?";
    } else {
        message = "Delete the selected " +
            (selectedLine ? "DR leg and its DR point" : "point") + "?";
    }
    if (!window.confirm(message)) {
        return;
    }

    affectedLines.forEach(line => {
        map.removeLayer(line.layer);
        map.removeLayer(line.annotation);
    });
    affectedGreatCircleRoutes.forEach(route => map.removeLayer(route.layer));
    affectedBearingLines.forEach(line => {
        map.removeLayer(line.layer);
        map.removeLayer(line.annotation);
        map.removeLayer(line.handle);
    });
    affectedIntercepts.forEach(intercept => {
        interceptLayers(intercept).forEach(layer => map.removeLayer(layer));
    });
    affectedPoints.forEach(point => map.removeLayer(point.marker));
    const removedLayers = new Set([
        ...Array.from(affectedLines, line => [line.layer, line.annotation]).flat(),
        ...Array.from(affectedBearingLines, line =>
            [line.layer, line.annotation, line.handle]
        ).flat(),
        ...Array.from(affectedIntercepts, intercept =>
            interceptLayers(intercept)
        ).flat(),
        ...Array.from(affectedGreatCircleRoutes, route => route.layer),
        ...Array.from(affectedPoints, point => point.marker)
    ]);
    objects = objects.filter(object => !removedLayers.has(object));
    navigationLines = navigationLines.filter(line => !affectedLines.has(line));
    bearingLines = bearingLines.filter(line => !affectedBearingLines.has(line));
    intercepts = intercepts.filter(intercept => !affectedIntercepts.has(intercept));
    greatCircleRoutes = greatCircleRoutes.filter(
        route => !affectedGreatCircleRoutes.has(route)
    );
    points = points.filter(point => !affectedPoints.has(point));
    selectedObject = null;
    updateSelectionStyle();
    setInfoMessage(affectedBearingLines.size || affectedIntercepts.size
        ? "FIX and attached navigation lines deleted"
        : "Object and dependent DRs deleted");
    persistNavigationState();
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
        deleteSelectedObject();
    }
});

document.getElementById("fixTool").onclick = () => {
    gcrStartPoint = null;
    if (mode === "fix") {
        mode = null;
        activateButton(null);
        setInfoMessage("FIX tool off");
        return;
    }
    mode = "fix";
    activateButton("fixTool");
    setInfoMessage("Click the map to place a FIX");
};

drButton.onclick = openDrPopup;
gcrButton.onclick = () => {
    if (mode === "gcr") {
        mode = null;
        gcrStartPoint = null;
        activateButton(null);
        setInfoMessage("GCR tool off");
        return;
    }
    if (!points.includes(selectedObject) || selectedObject.type !== "FIX") {
        return;
    }
    mode = "gcr";
    gcrStartPoint = selectedObject;
    activateButton("gcrTool");
    setInfoMessage(
        "Click the map to place the final FIX for a Great Circle Route from " +
        gcrStartPoint.label
    );
};
brgToButton.onclick = openBearingPopup;
interceptButton.onclick = openInterceptPopup;
document.getElementById("drCancel").onclick = closeDrPopup;
document.getElementById("brgToCancel").onclick = closeBearingPopup;
document.getElementById("intCancel").onclick = closeInterceptPopup;
drPopup.addEventListener("click", event => event.stopPropagation());
brgToPopup.addEventListener("click", event => event.stopPropagation());
intPopup.addEventListener("click", event => event.stopPropagation());

drForm.addEventListener("submit", event => {
    event.preventDefault();
    const bearingDegrees = Number(drBearing.value);
    const distance = Number(drDistance.value);
    if (
        drBearing.value.trim() === "" ||
        drDistance.value.trim() === "" ||
        !Number.isFinite(bearingDegrees) ||
        bearingDegrees < 0 ||
        bearingDegrees > 360 ||
        !Number.isFinite(distance) ||
        distance <= 0 ||
        !points.includes(selectedObject)
    ) {
        drError.textContent = "Enter a bearing from 0° to 360° and a positive distance.";
        return;
    }
    const startPoint = selectedObject;
    closeDrPopup();
    createDrLine(startPoint, bearingDegrees % 360, distance);
});

brgToForm.addEventListener("submit", event => {
    event.preventDefault();
    const bearingDegrees = Number(brgToBearing.value);
    if (
        brgToBearing.value.trim() === "" ||
        !Number.isFinite(bearingDegrees) ||
        bearingDegrees < 0 ||
        bearingDegrees > 360 ||
        !points.includes(selectedObject) ||
        selectedObject.type !== "FIX"
    ) {
        brgToError.textContent = "Enter a bearing from 0° to 360°.";
        return;
    }
    const fixPoint = selectedObject;
    closeBearingPopup();
    const line = createBearingLine(fixPoint, bearingDegrees % 360, 5);
    selectObject(line);
    persistNavigationState();
});

intForm.addEventListener("submit", event => {
    event.preventDefault();
    const starName = intName.value.trim();
    const bearing = Number(intBearing.value);
    const distance = Number(intDistance.value);
    if (
        !starName ||
        intBearing.value.trim() === "" ||
        intDistance.value.trim() === "" ||
        !Number.isFinite(bearing) ||
        bearing < 0 ||
        bearing > 360 ||
        !Number.isFinite(distance) ||
        !points.includes(selectedObject) ||
        selectedObject.type !== "FIX"
    ) {
        intError.textContent =
            "Enter a star name, bearing from 0° to 360°, and a numeric intercept distance.";
        return;
    }
    const apPoint = selectedObject;
    closeInterceptPopup();
    const intercept = createIntercept(
        apPoint,
        starName,
        bearing % 360,
        distance
    );
    selectObject(intercept);
    persistNavigationState();
});

pointInfo.addEventListener("submit", applyPointEdits);
lineInfo.addEventListener("submit", applyLineEdits);
interceptInfo.addEventListener("submit", applyInterceptEdits);

document.getElementById("clearTool").onclick = () => {
    objects.forEach(object => map.removeLayer(object));
    objects = [];
    points = [];
    navigationLines = [];
    bearingLines = [];
    intercepts = [];
    greatCircleRoutes = [];
    selectedObject = null;
    mode = null;
    gcrStartPoint = null;
    drPopup.hidden = true;
    brgToPopup.hidden = true;
    intPopup.hidden = true;
    nextFixNumber = 1;
    nextDrNumber = 1;
    nextPointId = 1;
    nextLineId = 1;
    activateButton(null);
    updateSelectionStyle();
    try {
        window.localStorage.removeItem(navigationStorageKey);
        setInfoMessage("Cleared");
    } catch (error) {
        showStorageError("clear", error);
    }
};

map.on("click", event => {
    if (mode === "gcr" && gcrStartPoint && points.includes(gcrStartPoint)) {
        const startPoint = gcrStartPoint;
        mode = null;
        gcrStartPoint = null;
        activateButton(null);
        const endPoint = createPoint(
            "FIX",
            event.latlng,
            "FIX " + nextFixNumber++
        );
        createGreatCircleRoute(startPoint, endPoint);
        selectObject(endPoint);
        persistNavigationState();
    } else if (mode === "fix") {
        const point = createPoint("FIX", event.latlng, "FIX " + nextFixNumber++);
        selectObject(point);
        persistNavigationState();
    }
});

restoreNavigationState();
if (viewportReadError) {
    showStorageError("load map viewport", viewportReadError);
} else if (invalidStoredViewport) {
    showStorageError("load map viewport", new Error("Saved map viewport is invalid"));
}