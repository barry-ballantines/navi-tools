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

const info = document.getElementById("info");

function activateButton(id) {
    document
        .querySelectorAll(".toolbar button")
        .forEach(btn => btn.classList.remove("active"));

    document
        .getElementById(id)
        .classList.add("active");
}

document.getElementById("distanceTool").onclick = () => {
    mode = "distance";
    activateButton("distanceTool");
    info.innerHTML = "Stechzirkel aktiv<br>Punkt 1 setzen";
};

document.getElementById("bearingTool").onclick = () => {
    mode = "bearing";
    activateButton("bearingTool");
    info.innerHTML = "Peilung aktiv<br>Punkt 1 setzen";
};

document.getElementById("losTool").onclick = () => {
    mode = "los";
    activateButton("losTool");
    info.innerHTML = "LOS aktiv<br>Punkt 1 setzen";
};

document.getElementById("clearTool").onclick = () => {
    objects.forEach(obj => map.removeLayer(obj));

    objects = [];
    points = [];
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

    objects.push(marker);
    points.push(marker);

    if (points.length < 2) {
        return;
    }

    const endpoints = points;
    const measurementMode = mode;

    const line = L.polyline(
        endpoints.map(point => point.getLatLng()),
        {
            color: "red",
            weight: 3
        }
    ).addTo(map);

    objects.push(line);

    function updateMeasurement() {
        const [p1, p2] = endpoints.map(point => point.getLatLng());
        line.setLatLngs([p1, p2]);

        const dist = distanceNM(p1, p2);
        const kurs = bearing(p1, p2);

        if (measurementMode === "distance") {

            info.innerHTML =
                "<b>Stechzirkel</b><br>" +
                dist.toFixed(2) +
                " sm";

        } else if (measurementMode === "bearing") {

            info.innerHTML =
                "<b>Peilung</b><br>" +
                kurs.toFixed(1) +
                "°";

        } else {

            info.innerHTML =
                "<b>LOS</b><br>" +
                "Distanz: " +
                dist.toFixed(2) +
                " sm<br>" +
                "Kurs: " +
                kurs.toFixed(1) +
                "°";
        }
    }

    endpoints.forEach(point => point.on("drag", updateMeasurement));
    updateMeasurement();
    points = [];
});