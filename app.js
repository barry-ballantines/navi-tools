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

osm.addTo(map);
seamark.addTo(map);

let mode = null;
let points = [];
let objects = [];
let measurements = [];
let selectedObject = null;

const info = document.getElementById("info");
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
            info.innerHTML = "LOS aktiv<br>Weiteren Punkt setzen";
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
        info.innerHTML = "Objekt gelöscht";
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
    info.innerHTML = "LOS aktiv<br>Punkt 1 setzen";
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

    info.innerHTML = "Gelöscht";
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
            title: "Punkt verschieben",
            alt: "Verschiebbarer Messpunkt",
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
            "Distanz: " +
            dist.toFixed(2) +
            " sm<br>" +
            "Kurs: " +
            kurs.toFixed(1) +
            "°";
    }

    endpoints.forEach(point => point.on("drag", updateMeasurement));
    updateMeasurement();
    points = [];
});