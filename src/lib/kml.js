import JSZip from "jszip";

const KML_NS = "http://www.opengis.net/kml/2.2";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function xmlText(el, selector) {
  return el?.querySelector(selector)?.textContent?.trim() || "";
}

function parseCoordinates(text) {
  return text
    .trim()
    .split(/\s+/)
    .map(pair => {
      const [lon, lat, alt = 0] = pair.split(",").map(Number);

      return {
        lat,
        lon,
        alt,
      };
    })
    .filter(
      p =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon)
    );
}

/*
 * Some Comptt_PTR KML files contain:
 *
 * xsi:schemaLocation="..."
 *
 * but forget to declare:
 *
 * xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 *
 * That makes the XML invalid according to DOMParser.
 *
 * This function repairs that common issue before parsing.
 */
function repairKmlNamespaces(kmlText) {
  if (!kmlText || typeof kmlText !== "string") {
    return kmlText;
  }

  // Already valid / namespace already declared.
  if (kmlText.includes("xmlns:xsi=")) {
    return kmlText;
  }

  // If xsi: is used anywhere, declare the namespace on <kml>.
  if (/\bxsi:/.test(kmlText)) {
    const kmlTagMatch = kmlText.match(/<kml\b[^>]*>/i);

    if (kmlTagMatch) {
      const oldKmlTag = kmlTagMatch[0];

      const newKmlTag = oldKmlTag.replace(
        /<kml\b/i,
        `<kml xmlns:xsi="${XSI_NS}"`
      );

      return kmlText.replace(
        oldKmlTag,
        newKmlTag
      );
    }
  }

  return kmlText;
}

function walkPlacemarks(doc, source) {
  const placemarks = [
    ...doc.getElementsByTagNameNS(
      KML_NS,
      "Placemark"
    ),
  ];

  const features = [];

  for (const pm of placemarks) {
    const name =
      xmlText(pm, "name") || "Unnamed";

    const description =
      xmlText(pm, "description");

    const lines = [
      ...pm.getElementsByTagNameNS(
        KML_NS,
        "LineString"
      ),
    ];

    const polygons = [
      ...pm.getElementsByTagNameNS(
        KML_NS,
        "Polygon"
      ),
    ];

    const points = [
      ...pm.getElementsByTagNameNS(
        KML_NS,
        "Point"
      ),
    ];

    // LineString
    for (const line of lines) {
      const c = xmlText(
        line,
        "coordinates"
      );

      const coords =
        parseCoordinates(c);

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
      const c = xmlText(
        poly,
        "coordinates"
      );

      const coords =
        parseCoordinates(c);

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

    // Point
    for (const point of points) {
      const c = xmlText(
        point,
        "coordinates"
      );

      const coords =
        parseCoordinates(c);

      if (coords.length) {
        features.push({
          type: "Point",
          name,
          description,
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

  /*
   * KMZ
   */
  if (
    file.name
      .toLowerCase()
      .endsWith(".kmz")
  ) {
    const zip =
      await JSZip.loadAsync(buf);

    const kmlEntry =
      Object.values(zip.files).find(
        x =>
          !x.dir &&
          x.name
            .toLowerCase()
            .endsWith(".kml")
      );

    if (!kmlEntry) {
      throw new Error(
        "No KML file found inside KMZ."
      );
    }

    kmlText =
      await kmlEntry.async("text");

    /*
     * Keep all KMZ assets.
     */
    for (const [name, entry] of Object.entries(
      zip.files
    )) {
      if (!entry.dir) {
        assets[name] =
          await entry.async("base64");
      }
    }
  } else {
    /*
     * Normal .kml file
     */
    kmlText =
      new TextDecoder().decode(buf);
  }

  /*
   * Repair common malformed KML namespace.
   */
  const repairedKmlText =
    repairKmlNamespaces(kmlText);

  /*
   * Parse XML.
   */
  const doc =
    new DOMParser().parseFromString(
      repairedKmlText,
      "application/xml"
    );

  /*
   * Check XML parser errors.
   */
  const parseError =
    doc.getElementsByTagName(
      "parsererror"
    )[0];

  if (parseError) {
    throw new Error(
      "Invalid KML/XML: " +
        parseError.textContent.slice(
          0,
          500
        )
    );
  }

  /*
   * Extract Placemark features.
   */
  const features =
    walkPlacemarks(
      doc,
      file.name
    );

  return {
    name: file.name,

    features,

    /*
     * Return repaired KML text.
     * This is useful when the original KML
     * was malformed but has been repaired.
     */
    kmlText: repairedKmlText,

    assets,
  };
}

function esc(s = "") {
  return String(s).replace(
    /[<>&'"]/g,
    c =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c]
  );
}

export function buildMergedKml(
  compartments,
  tracks
) {
  const placemarks = [];

  /*
   * COMPARTMENT FEATURES
   */
  compartments.forEach((f, i) => {
    const coords = f.coords
      .map(
        p =>
          `${p.lon},${p.lat},${
            p.alt || 0
          }`
      )
      .join(" ");

    const geometry =
      f.type === "Polygon"
        ? `<Polygon>
            <outerBoundaryIs>
              <LinearRing>
                <coordinates>${coords}</coordinates>
              </LinearRing>
            </outerBoundaryIs>
          </Polygon>`
        : f.type === "LineString"
          ? `<LineString>
              <tessellate>1</tessellate>
              <coordinates>${coords}</coordinates>
            </LineString>`
          : `<Point>
              <coordinates>${coords}</coordinates>
            </Point>`;

    placemarks.push(
      `<Placemark>
        <name>${esc(
          f.name ||
            `Compartment ${i + 1}`
        )}</name>
        <styleUrl>#compartment</styleUrl>
        ${geometry}
      </Placemark>`
    );
  });

  /*
   * PATROL TRACK FEATURES
   */
  tracks.forEach((f, i) => {
    const coords = f.coords
      .map(
        p =>
          `${p.lon},${p.lat},${
            p.alt || 0
          }`
      )
      .join(" ");

    placemarks.push(
      `<Placemark>
        <name>${esc(
          f.name ||
            `Patrol Track ${i + 1}`
        )}</name>
        <description><![CDATA[${
          f.description || ""
        }]]></description>
        <styleUrl>#patrol</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coords}</coordinates>
        </LineString>
      </Placemark>`
    );
  });

  /*
   * MERGED KML
   */
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml
  xmlns="${KML_NS}"
  xmlns:gx="http://www.google.com/kml/ext/2.2"
>
<Document>

<name>
  PatrolTrack - Comptt_PTR + Patrol Tracks
</name>

<Style id="compartment">
  <LineStyle>
    <!-- Yellow -->
    <color>ff00ffff</color>
    <width>3</width>
  </LineStyle>

  <PolyStyle>
    <!-- Transparent yellow -->
    <color>3300ffff</color>
  </PolyStyle>
</Style>

<Style id="patrol">
  <LineStyle>
    <!-- Red -->
    <color>ff0000ff</color>
    <width>5</width>
  </LineStyle>
</Style>

<Folder>
  <name>COMPARTMENT BOUNDARIES - Comptt_PTR</name>
  ${placemarks
    .filter(
      x =>
        x.includes(
          "styleUrl>#compartment"
        )
    )
    .join("")}
</Folder>

<Folder>
  <name>PATROL TRACKS</name>
  ${placemarks
    .filter(
      x =>
        x.includes(
          "styleUrl>#patrol"
        )
    )
    .join("")}
</Folder>

</Document>
</kml>`;
}

export async function buildKmz(
  kmlText
) {
  const zip = new JSZip();

  zip.file(
    "doc.kml",
    kmlText
  );

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
}