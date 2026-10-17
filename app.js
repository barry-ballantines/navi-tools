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
    const totalMinutes = Math.round(Math.abs(value) * 60);
    const degrees = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const degreeDigits = isLatitude ? 2 : 3;

    return (
        hemisphere +
        " " +
        String(degrees).padStart(degreeDigits, "0") +
        "°" +
        (minutes ? " " + String(minutes).padStart(2, "0") + "'" : "")
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
                const label = formatGridCoordinate(longitude, false);

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
                const label = formatGridCoordinate(latitude, true);

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
let objects = [];
let selectedObject = null;
let nextFixNumber = 1;
let nextDrNumber = 1;

const infoMessage = document.getElementById("infoMessage");
const pointInfo = document.getElementById("pointInfo");
const pointType = document.getElementById("pointType");
const pointLabel = document.getElementById("pointLabel");
const pointPosition = document.getElementById("pointPosition");
const lineInfo = document.getElementById("lineInfo");
const lineBearing = document.getElementById("lineBearing");
const lineDistance = document.getElementById("lineDistance");
const drButton = document.getElementById("drTool");
const drPopup = document.getElementById("drPopup");
const drForm = document.getElementById("drForm");
const drStartLabel = document.getElementById("drStartLabel");
const drBearing = document.getElementById("drBearing");
const drDistance = document.getElementById("drDistance");
const drError = document.getElementById("drError");
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
    infoMessage.textContent = message;
    pointInfo.hidden = true;
    lineInfo.hidden = true;
}

function formatPositionCoordinate(value, isLatitude, precision = 3) {
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
        /^\s*([NS])\s*(\d{1,2})°\s*(\d{1,2})\.(\d{3})'\s*-\s*([EW])\s*(\d{1,3})°\s*(\d{1,2})\.(\d{3})'\s*$/i
    );
    if (!match) {
        return null;
    }

    const [, latitudeHemisphere, latitudeDegreesText, latitudeMinutesText,
        latitudeFractionText, longitudeHemisphere, longitudeDegreesText,
        longitudeMinutesText, longitudeFractionText] = match;
    const latitudeDegrees = Number(latitudeDegreesText);
    const latitudeMinutes =
        Number(latitudeMinutesText) + Number("0." + latitudeFractionText);
    const longitudeDegrees = Number(longitudeDegreesText);
    const longitudeMinutes =
        Number(longitudeMinutesText) + Number("0." + longitudeFractionText);
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
    infoMessage.textContent = "";
    pointInfo.hidden = false;
    lineInfo.hidden = true;
    pointType.textContent = point.type + " point";
    pointLabel.value = point.label;
    pointPosition.value = formatPosition(point.latlng);
    const isFix = point.type === "FIX";
    pointPosition.disabled = !isFix;
}

function showLineInfo(line) {
    infoMessage.textContent = "";
    pointInfo.hidden = true;
    lineInfo.hidden = false;
    lineBearing.value = line.bearing;
    lineDistance.value = line.distanceNM;
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
    drButton.disabled = !selectedObject || !points.includes(selectedObject);
}

function selectObject(object) {
    selectedObject = object;
    updateSelectionStyle();
    if (points.includes(object)) {
        showPointInfo(object);
    } else if (navigationLines.includes(object)) {
        showLineInfo(object);
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

function updateLineAndDescendants(line) {
    const start = line.startPoint.latlng;
    const end = destinationPoint(start, line.bearing, line.distanceNM);
    line.endPoint.latlng = end;
    line.endPoint.marker.setLatLng(end);
    line.endPoint.marker.setIcon(
        pointIcon(line.endPoint, line.endPoint === selectedObject)
    );
    line.layer.setLatLngs([start, end]);
    updateLineAnnotation(line);
    navigationLines
        .filter(candidate => candidate.startPoint === line.endPoint)
        .forEach(updateLineAndDescendants);
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
    navigationLines.forEach(updateLineAnnotation);
}

map.on("moveend", updateLineAnnotations);
map.on("zoomend", updateLineAnnotations);
map.on("resize", updateLineAnnotations);

function createPoint(type, latlng, label) {
    const point = { type, label, latlng, marker: null, incomingLine: null };
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
            point.marker.setIcon(pointIcon(point, point === selectedObject));
            navigationLines
                .filter(line => line.startPoint === point)
                .forEach(updateLineAndDescendants);
            if (selectedObject === point) {
                showPointInfo(point);
            }
        });
    }
    points.push(point);
    objects.push(point.marker);
    return point;
}

function createDrLine(startPoint, bearingDegrees, distanceNM) {
    const endPoint = createPoint(
        "DR",
        destinationPoint(startPoint.latlng, bearingDegrees, distanceNM),
        "DR " + nextDrNumber++
    );
    const line = {
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
    selectObject(endPoint);
}

function activateButton(id) {
    document
        .querySelectorAll(".toolbar button")
        .forEach(button => button.classList.remove("active"));
    if (id) {
        document.getElementById(id).classList.add("active");
    }
}

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
            "Enter a label and position in the format N 54° 10.123' - E 010° 12.456'.";
        return;
    }

    selectedObject.label = label;
    if (selectedObject.type === "FIX") {
        selectedObject.latlng = position;
        selectedObject.marker.setLatLng(selectedObject.latlng);
        navigationLines
            .filter(line => line.startPoint === selectedObject)
            .forEach(updateLineAndDescendants);
    }
    selectedObject.marker.setIcon(pointIcon(selectedObject, true));
    showPointInfo(selectedObject);
}

function applyLineEdits(event) {
    event.preventDefault();
    if (!navigationLines.includes(selectedObject)) {
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
    updateLineAndDescendants(selectedObject);
    showLineInfo(selectedObject);
}

function collectDescendantLines(point, result) {
    navigationLines
        .filter(line => line.startPoint === point && !result.has(line))
        .forEach(line => {
            result.add(line);
            collectDescendantLines(line.endPoint, result);
        });
}

function deleteSelectedObject() {
    if (!selectedObject) {
        return;
    }
    const selectedLine = navigationLines.includes(selectedObject)
        ? selectedObject
        : null;
    const selectedPoint = points.includes(selectedObject)
        ? selectedObject
        : null;
    const affectedLines = new Set();
    const affectedPoints = new Set();
    if (selectedLine) {
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

    const cascades = affectedPoints.size > 1 || affectedLines.size > 1;
    const message = cascades
        ? "Delete this object and " + (affectedPoints.size - (selectedPoint ? 1 : 0)) +
            " dependent DR point(s) and their lines?"
        : "Delete the selected " + (selectedLine ? "DR leg and its DR point" : "point") + "?";
    if (!window.confirm(message)) {
        return;
    }

    affectedLines.forEach(line => {
        map.removeLayer(line.layer);
        map.removeLayer(line.annotation);
    });
    affectedPoints.forEach(point => map.removeLayer(point.marker));
    const removedLayers = new Set([
        ...Array.from(affectedLines, line => [line.layer, line.annotation]).flat(),
        ...Array.from(affectedPoints, point => point.marker)
    ]);
    objects = objects.filter(object => !removedLayers.has(object));
    navigationLines = navigationLines.filter(line => !affectedLines.has(line));
    points = points.filter(point => !affectedPoints.has(point));
    selectedObject = null;
    updateSelectionStyle();
    setInfoMessage("Object and dependent DRs deleted");
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
document.getElementById("drCancel").onclick = closeDrPopup;
drPopup.addEventListener("click", event => event.stopPropagation());

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

pointInfo.addEventListener("submit", applyPointEdits);
lineInfo.addEventListener("submit", applyLineEdits);

document.getElementById("clearTool").onclick = () => {
    objects.forEach(object => map.removeLayer(object));
    objects = [];
    points = [];
    navigationLines = [];
    selectedObject = null;
    mode = null;
    drPopup.hidden = true;
    nextFixNumber = 1;
    nextDrNumber = 1;
    activateButton(null);
    updateSelectionStyle();
    setInfoMessage("Cleared");
};

map.on("click", event => {
    if (mode !== "fix") {
        return;
    }
    const point = createPoint("FIX", event.latlng, "FIX " + nextFixNumber++);
    selectObject(point);
});