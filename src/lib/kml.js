import JSZip from "jszip";

const KML_NS = "http://www.opengis.net/kml/2.2";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function xmlText(el, selector) {
  if (!selector) return el?.textContent?.trim() || "";
  return el?.querySelector(selector)?.textContent?.trim() || "";
}

function parseCoordinates(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lon, lat, alt = 0] = pair.split(",").map(Number);
      return { lat, lon, alt };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

function repairKmlNamespaces(kmlText) {
  if (!kmlText || typeof kmlText !== "string") return kmlText;
  if (kmlText.includes("xmlns:xsi=")) return kmlText;

  if (/\bxsi:/.test(kmlText)) {
    const kmlTagMatch = kmlText.match(/<kml\b[^>]*>/i);
    if (kmlTagMatch) {
      const oldKmlTag = kmlTagMatch[0];
      const newKmlTag = oldKmlTag.replace(/<kml\b/i, `<kml xmlns:xsi="${XSI_NS}"`);
      return kmlText.replace(oldKmlTag, newKmlTag);
    }
  }
  return kmlText;
}

// Safely escape CDATA content
function safeCdata(text = "") {
  return String(text).replace(/\]\]>/g, "]]&gt;");
}

// Extract metadata from SimpleData or HTML/Plaintext descriptions
function parseDescriptionMetadata(descText, pm) {
  const meta = {};

  // 1. Extract from KML ExtendedData/SimpleData
  const simpleDataEls = [
    ...Array.from(pm.getElementsByTagNameNS(KML_NS, "SimpleData")),
    ...Array.from(pm.getElementsByTagName("SimpleData")),
  ];

  for (const sd of simpleDataEls) {
    const name = sd.getAttribute("name");
    if (name) meta[name] = sd.textContent?.trim();
  }

  // 2. Extract key-value pairs (supports HTML <b>Key:</b> Val AND Plaintext "Key: Val")
  if (descText) {
    // Matches <b>Key:</b> Value or Key: Value line by line
    const regex = /(?:<b>)?\s*([A-Za-z0-9\s_-]+)\s*:\s*(?:<\/b>)?\s*([^<\n\r]+)/gi;
    let match;
    while ((match = regex.exec(descText)) !== null) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (key && val) meta[key] = val;
    }
  }

  return meta;
}

function walkPlacemarks(doc, source) {
  const placemarks = [
    ...Array.from(doc.getElementsByTagNameNS(KML_NS, "Placemark")),
    ...Array.from(doc.getElementsByTagName("Placemark")),
  ];

  const uniquePlacemarks = Array.from(new Set(placemarks));
  const features = [];

  for (const pm of uniquePlacemarks) {
    const name = xmlText(pm, "name") || "Unnamed";
    const description = xmlText(pm, "description");
    const meta = parseDescriptionMetadata(description, pm);

    const getElements = (tagName) => {
      const nsEls = Array.from(pm.getElementsByTagNameNS(KML_NS, tagName));
      const noNsEls = Array.from(pm.getElementsByTagName(tagName));
      return Array.from(new Set([...nsEls, ...noNsEls]));
    };

    const lines = getElements("LineString");
    const polygons = getElements("Polygon");
    const points = getElements("Point");

    // LineString
    for (const line of lines) {
      const coords = parseCoordinates(xmlText(line, "coordinates"));
      if (coords.length > 1) {
        features.push({
          type: "LineString",
          name,
          description,
          coords,
          source,
        });
      }
    }

    // Polygon
    for (const poly of polygons) {
      const coords = parseCoordinates(xmlText(poly, "coordinates"));
      if (coords.length > 2) {
        features.push({
          type: "Polygon",
          name,
          description,
          coords,
          source,
        });
      }
    }

    // Point (Wildlife Observation)
    for (const point of points) {
      const coords = parseCoordinates(xmlText(point, "coordinates"));
      if (coords.length) {
        features.push({
          type: "Point",
          name,
          species: meta.Species || meta.species || name,
          category: meta.Category || meta.category || "",
          id: meta.ID || meta.id || "",
          date: meta.Date || meta.date || "",
          time: meta.Time || meta.time || "",
          animalCode: meta["Animal Code"] || meta.animalCode || "",
          patrolUid: meta["Patrol UID"] || meta.patrolUid || "",
          n: meta.Total || meta.n || "",
          male: meta.Male || meta.male || "",
          female: meta.Female || meta.female || "",
          young: meta.Young || meta.young || "",
          unknown: meta.Unknown || meta.unknown || "",
          description,
          lat: coords[0].lat,
          lon: coords[0].lon,
          coords,
          source,
        });
      }
    }
  }

  return features;
}

export async function parseKmlOrKmz(file) {
  const buf = await file.arrayBuffer();
  let kmlText;
  let assets = {};

  if (file.name.toLowerCase().endsWith(".kmz")) {
    const zip = await JSZip.loadAsync(buf);
    const kmlEntry = Object.values(zip.files).find(
      (x) => !x.dir && x.name.toLowerCase().endsWith(".kml")
    );

    if (!kmlEntry) throw new Error("No KML file found inside KMZ.");
    kmlText = await kmlEntry.async("text");

    for (const [name, entry] of Object.entries(zip.files)) {
      if (!entry.dir) assets[name] = await entry.async("base64");
    }
  } else {
    kmlText = new TextDecoder().decode(buf);
  }

  const repairedKmlText = repairKmlNamespaces(kmlText);
  const doc = new DOMParser().parseFromString(repairedKmlText, "application/xml");

  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error("Invalid KML/XML: " + parseError.textContent.slice(0, 500));
  }

  const features = walkPlacemarks(doc, file.name);

  return {
    name: file.name,
    features,
    kmlText: repairedKmlText,
    assets,
  };
}

function esc(s = "") {
  return String(s).replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      }[c])
  );
}

function getWildlifeCategory(wildlife) {
  const category = String(wildlife.category || "").toLowerCase();
  const species = String(wildlife.species || wildlife.name || "").toLowerCase();

  if (category.includes("carnivore") || species.includes("tiger") || species.includes("leopard")) {
    return "carnivore";
  }
  if (category.includes("herbivore") || species.includes("deer") || species.includes("sambar")) {
    return "herbivore";
  }
  if (category.includes("bird")) {
    return "bird";
  }
  if (
    category.includes("reptile") ||
    species.includes("snake") ||
    species.includes("crocodile") ||
    species.includes("monitor") ||
    species.includes("turtle") ||
    species.includes("lizard")
  ) {
    return "reptile";
  }
  if (
    category.includes("primate") ||
    species.includes("langur") ||
    species.includes("macaque")
  ) {
    return "primate";
  }

  return "other";
}

function buildWildlifePlacemark(w, index) {
  const lat = Number(w.lat ?? w.Lat ?? w.coords?.[0]?.lat);
  const lon = Number(w.lon ?? w.long ?? w.Long ?? w.coords?.[0]?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";

  const category = getWildlifeCategory(w);
  const species = w.species || w.Species || w.name || "Unknown Wildlife";
  const id = w.id ?? w.ID ?? `W-${index + 1}`;

  return `
    <Placemark>
      <name>${esc(species)}</name>
      <description><![CDATA[
        <b>Wildlife Observation</b><br/>
        <b>ID:</b> ${esc(id)}<br/>
        <b>Category:</b> ${esc(w.category || category)}<br/>
        <b>Species:</b> ${esc(species)}<br/>
        <b>Animal Code:</b> ${esc(w.animalCode || "")}<br/>
        <b>Date:</b> ${esc(w.date || "")}<br/>
        <b>Time:</b> ${esc(w.time || "")}<br/>
        <b>Total:</b> ${esc(w.n || "")}<br/>
        <b>Male:</b> ${esc(w.male || "")}<br/>
        <b>Female:</b> ${esc(w.female || "")}<br/>
        <b>Young:</b> ${esc(w.young || "")}<br/>
        <b>Unknown:</b> ${esc(w.unknown || "")}<br/>
        <b>Patrol UID:</b> ${esc(w.patrolUid || "")}<br/>
        <b>Latitude:</b> ${lat}<br/>
        <b>Longitude:</b> ${lon}
      ]]></description>
      <styleUrl>#wildlife-${category}</styleUrl>
      <Point>
        <coordinates>${lon},${lat},0</coordinates>
      </Point>
    </Placemark>
  `;
}

export function buildMergedKml(compartments = [], tracks = [], wildlife = []) {
  const compartmentPlacemarks = [];
  const patrolPlacemarks = [];

  compartments.forEach((f, i) => {
    if (f.type === "Point") return;
    if (!["Polygon", "LineString"].includes(f.type)) return;

    const coords = f.coords.map((p) => `${p.lon},${p.lat},${p.alt || 0}`).join(" ");
    const compName =
      f.name ||
      f.COMPTT_NO ||
      f.COMPTT_NAME ||
      f.COMP_NO ||
      f.properties?.COMPTT_NO ||
      f.properties?.COMPTT_NAME ||
      f.properties?.name ||
      `Compartment ${i + 1}`;

    const geometry =
      f.type === "Polygon"
        ? `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        : `<LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString>`;

    compartmentPlacemarks.push(`
      <Placemark>
        <name>${esc(compName)}</name>
        <styleUrl>#compartment</styleUrl>
        ${geometry}
      </Placemark>
    `);
  });

  tracks.forEach((f, i) => {
    if (f.type !== "LineString") return;
    const coords = f.coords.map((p) => `${p.lon},${p.lat},${p.alt || 0}`).join(" ");

    patrolPlacemarks.push(`
      <Placemark>
        <name>${esc(f.name || `Patrol Track ${i + 1}`)}</name>
        <description><![CDATA[${safeCdata(f.description || "")}]]></description>
        <styleUrl>#patrol</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coords}</coordinates>
        </LineString>
      </Placemark>
    `);
  });

  const wildlifePlacemarks = wildlife
    .map((w, i) => ({
      xml: buildWildlifePlacemark(w, i),
      category: getWildlifeCategory(w),
    }))
    .filter((item) => item.xml !== "");

  const getCategoryXml = (cat) =>
    wildlifePlacemarks
      .filter((item) => item.category === cat)
      .map((item) => item.xml)
      .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="${KML_NS}" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>PatrolTrack - Comptt_PTR + Patrol Tracks + Wildlife</name>

  <Style id="compartment">
    <LineStyle><color>ff00ffff</color><width>3</width></LineStyle>
    <PolyStyle><fill>0</fill><outline>1</outline></PolyStyle>
  </Style>
  <Style id="patrol">
    <LineStyle><color>ff0000ff</color><width>2</width></LineStyle>
  </Style>
  <Style id="wildlife-carnivore">
    <IconStyle><scale>0.65</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>
  </Style>
  <Style id="wildlife-herbivore">
    <IconStyle><scale>0.65</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>
  </Style>
  <Style id="wildlife-bird">
    <IconStyle><scale>0.65</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>
  </Style>
  <Style id="wildlife-reptile">
    <IconStyle><scale>0.65</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>
  </Style>
  <Style id="wildlife-primate">
    <IconStyle><scale>0.65</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>
  </Style>
  <Style id="wildlife-other">
    <IconStyle><scale>0.65</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon></IconStyle>
  </Style>

  <Folder>
    <name>COMPARTMENT BOUNDARIES - Comptt_PTR</name>
    ${compartmentPlacemarks.join("")}
  </Folder>
  <Folder>
    <name>PATROL TRACKS</name>
    ${patrolPlacemarks.join("")}
  </Folder>
  <Folder>
    <name>WILDLIFE OBSERVATIONS</name>
    <Folder><name>🔴 CARNIVORES</name>${getCategoryXml("carnivore")}</Folder>
    <Folder><name>🟢 HERBIVORES</name>${getCategoryXml("herbivore")}</Folder>
    <Folder><name>🔵 BIRDS</name>${getCategoryXml("bird")}</Folder>
    <Folder><name>🟠 REPTILES</name>${getCategoryXml("reptile")}</Folder>
    <Folder><name>🟣 PRIMATES</name>${getCategoryXml("primate")}</Folder>
    <Folder><name>⚪ OTHER WILDLIFE</name>${getCategoryXml("other")}</Folder>
  </Folder>
</Document>
</kml>`;
}

export async function buildKmz(kmlText) {
  const zip = new JSZip();
  zip.file("doc.kml", kmlText);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}