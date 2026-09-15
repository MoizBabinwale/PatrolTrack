import React, { useMemo, useState } from "react";

import {
  Database,
   Map as MapIcon,
  FileArchive,
  FileText,
  Upload,
  Download,
  Search,
  Trash2,
  Menu,
  X,
  Layers,
  Route,
  Table2,
  Activity,
  Clock,
  MapPinned,
  RefreshCw,
} from "lucide-react";

import { saveAs } from "file-saver";

import {
  loadDatabase,
  inspectSqlite,
  getPatrolTracks,
  getPatrolMetadata,
  getPatrolIds,
  getTracksForPatrol,
} from "./lib/db";

import {
  parseKmlOrKmz,
  buildMergedKml,
  buildKmz,
} from "./lib/kml";

import MapView from "./components/MapView";
import ReportTable from "./components/ReportTable";

/* =========================================================
   NAVIGATION
========================================================= */

const nav = [
  ["dashboard", "Dashboard", Database],
  ["data", "Extracted Data", Table2],
  ["map", "Map & Tracks", MapIcon],
  ["report", "PTR Report", FileText],
];

/* =========================================================
   MAIN APP
========================================================= */

export default function App() {
  const [dbFile, setDbFile] = useState(null);
  const [ptrFile, setPtrFile] = useState(null);

  // Actual SQL.js Database object
  const [db, setDb] = useState(null);

  // Inspection / UI data
  const [dbInfo, setDbInfo] = useState(null);

  // PTR KML/KMZ
  const [ptr, setPtr] = useState(null);

  // Actual MSTrIPES GPS tracks
  const [trackFeatures, setTrackFeatures] = useState([]);

  // Patrol metadata
  const [patrolMetadata, setPatrolMetadata] = useState([]);

  // Patrol summary
  const [patrolSummary, setPatrolSummary] = useState([]);

  const [active, setActive] = useState("dashboard");

  const [search, setSearch] = useState("");

  const [selectedPatrol, setSelectedPatrol] = useState("ALL");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [mobileOpen, setMobileOpen] = useState(false);

  /* =========================================================
     COMBINED MAP FEATURES
  ========================================================= */

  const allFeatures = useMemo(() => {
    return [
      ...(ptr?.features || []),
      ...trackFeatures,
    ];
  }, [ptr, trackFeatures]);

  /* =========================================================
     DATABASE STATISTICS
  ========================================================= */

  const stats = useMemo(() => {
    const tables = dbInfo?.tables || [];

    const rows = tables.reduce((total, table) => {
      return total + Number(table.rowCount || 0);
    }, 0);

    return {
      tables: tables.length,
      rows,
      ptrFeatures: ptr?.features?.length || 0,
      tracks: trackFeatures.length,
      gpsPoints: trackFeatures.reduce(
        (total, track) => total + (track.coords?.length || 0),
        0
      ),
      patrols: patrolSummary.length,
    };
  }, [dbInfo, ptr, trackFeatures, patrolSummary]);

  /* =========================================================
     LOAD SQLITE DATABASE
  ========================================================= */

  async function loadDb(file) {
    if (!file) return;

    setError("");
    setLoading(true);
    setDbFile(file);

    try {
      console.log("Loading SQLite database:", file.name);

      /*
       * IMPORTANT:
       *
       * loadDatabase() returns the REAL SQL.js Database object.
       *
       * Do NOT use:
       * const result = await inspectSqlite(file)
       *
       * Instead:
       */
      const database = await loadDatabase(file);

      console.log("SQLite database:", database);
      console.log("db.exec:", typeof database.exec);

      if (
        !database ||
        typeof database.exec !== "function"
      ) {
        throw new Error(
          "The uploaded file could not be initialized as a SQLite database."
        );
      }

      /*
       * Inspect database structure
       */
      const inspection = inspectSqlite(database);

      console.log(
        "SQLite inspection completed:",
        inspection
      );

      /*
       * Get actual MSTrIPES GPS points
       */
      let gpsTracks = [];

      try {
        gpsTracks = getPatrolTracks(database);

        console.log(
          "MSTrIPES GPS points:",
          gpsTracks.length
        );
      } catch (trackError) {
        console.warn(
          "Unable to read tracks table:",
          trackError
        );
      }

      /*
       * Get patrol metadata
       */
      let metadata = [];

      try {
        metadata = getPatrolMetadata(database);

        console.log(
          "P05_Patrol records:",
          metadata.length
        );
      } catch (metadataError) {
        console.warn(
          "Unable to read P05_Patrol:",
          metadataError
        );
      }

      /*
       * Get patrol summary
       */
      let summary = [];

      try {
        summary = getPatrolIds(database);

        console.log(
          "Patrol summary:",
          summary
        );
      } catch (summaryError) {
        console.warn(
          "Unable to create patrol summary:",
          summaryError
        );
      }

      /*
       * Convert GPS points into map LineStrings.
       *
       * tracks table contains individual GPS points.
       * We group them by patrol_id.
       */
      const grouped = new Map();

      for (const point of gpsTracks) {
        const patrolId =
          point.patrol_id || "UNKNOWN";

        const latitude = Number(point.latitude);
        const longitude = Number(point.longitude);

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {
          continue;
        }

        if (!grouped.has(patrolId)) {
          grouped.set(patrolId, []);
        }

        grouped.get(patrolId).push({
          lat: latitude,
          lon: longitude,
          alt: Number(point.altitude) || 0,
          accuracy: point.accuracy,
          date: point.date,
          time: point.time,
        });
      }

      /*
       * Convert groups to LineString map features.
       */
      const features = [];

      for (const [patrolId, coords] of grouped.entries()) {
        if (coords.length < 2) {
          continue;
        }

        features.push({
          type: "LineString",

          name: `Patrol Track - ${patrolId}`,

          description:
            `${coords.length.toLocaleString()} GPS points`,

          coords,

          source: file.name,

          patrolId,
        });
      }

      console.log(
        "Map patrol features:",
        features.length
      );

      /*
       * Store everything.
       */
      setDb(database);

      setDbInfo(inspection);

      setTrackFeatures(features);

      setPatrolMetadata(metadata);

      setPatrolSummary(summary);

      /*
       * Automatically move to dashboard.
       */
      setActive("dashboard");
    } catch (e) {
      console.error(
        "SQLite loading error:",
        e
      );

      setError(
        e?.message ||
          "Unable to read SQLite database."
      );

      setDb(null);
      setDbInfo(null);
      setTrackFeatures([]);
      setPatrolMetadata([]);
      setPatrolSummary([]);
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     LOAD PTR KML/KMZ
  ========================================================= */

  async function loadPtr(file) {
    if (!file) return;

    setError("");
    setLoading(true);
    setPtrFile(file);

    try {
      console.log(
        "Loading Comptt_PTR:",
        file.name
      );

      const result =
        await parseKmlOrKmz(file);

      console.log(
        "PTR features:",
        result?.features?.length || 0
      );

      setPtr(result);

      setActive("map");
    } catch (e) {
      console.error(
        "PTR loading error:",
        e
      );

      setError(
        e?.message ||
          "Unable to read KML/KMZ."
      );

      setPtr(null);
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     DOWNLOAD KML
  ========================================================= */

  async function downloadKml() {
    if (!ptr || trackFeatures.length === 0) {
      setError(
        "Please upload both the Comptt_PTR KML/KMZ and patrol database first."
      );

      return;
    }

    try {
      setError("");

      const mergedKml = buildMergedKml(
        ptr.features,
        trackFeatures
      );

      const blob = new Blob(
        [mergedKml],
        {
          type:
            "application/vnd.google-earth.kml+xml",
        }
      );

      saveAs(
        blob,
        "OVERLAP_Comptt_PTR_PATROL.kml"
      );
    } catch (e) {
      console.error(e);

      setError(
        e?.message ||
          "Unable to create KML."
      );
    }
  }

  /* =========================================================
     DOWNLOAD KMZ
  ========================================================= */

  async function downloadKmz() {
    if (!ptr || trackFeatures.length === 0) {
      setError(
        "Please upload both the Comptt_PTR KML/KMZ and patrol database first."
      );

      return;
    }

    try {
      setError("");

      const mergedKml = buildMergedKml(
        ptr.features,
        trackFeatures
      );

      const blob =
        await buildKmz(mergedKml);

      saveAs(
        blob,
        "OVERLAP_Comptt_PTR_PATROL.kmz"
      );
    } catch (e) {
      console.error(e);

      setError(
        e?.message ||
          "Unable to create KMZ."
      );
    }
  }

  /* =========================================================
     RESET
  ========================================================= */

  function reset() {
    setDb(null);
    setDbInfo(null);

    setPtr(null);

    setDbFile(null);
    setPtrFile(null);

    setTrackFeatures([]);
    setPatrolMetadata([]);
    setPatrolSummary([]);

    setSelectedPatrol("ALL");

    setSearch("");

    setError("");
  }

  /* =========================================================
     FILTER TRACKS
  ========================================================= */

  const visibleFeatures = useMemo(() => {
    if (
      selectedPatrol === "ALL"
    ) {
      return allFeatures;
    }

    return [
      ...(ptr?.features || []),
      ...trackFeatures.filter(
        (feature) =>
          feature.patrolId ===
          selectedPatrol
      ),
    ];
  }, [
    allFeatures,
    ptr,
    trackFeatures,
    selectedPatrol,
  ]);

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="no-print sticky top-0 z-50 border-b bg-white/95 backdrop-blur">

        <div className="flex h-16 items-center justify-between px-4 lg:px-6">

          <div className="flex items-center gap-3">

            <button
              className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
              onClick={() =>
                setMobileOpen(!mobileOpen)
              }
            >
              {mobileOpen ? (
                <X />
              ) : (
                <Menu />
              )}
            </button>

            <div className="rounded-xl bg-emerald-700 p-2 text-white">
              <Layers size={21} />
            </div>

            <div>
              <div className="font-bold">
                PatrolTrack GIS
              </div>

              <div className="hidden text-xs text-slate-500 sm:block">
                MSTrIPES • Comptt_PTR • Patrol Analysis
              </div>
            </div>

          </div>

          <div className="flex gap-2">

            <button
              onClick={downloadKml}
              disabled={
                !ptr ||
                trackFeatures.length === 0
              }
              className="hidden items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40 sm:flex"
            >
              <Download size={16} />
              KML
            </button>

            <button
              onClick={downloadKmz}
              disabled={
                !ptr ||
                trackFeatures.length === 0
              }
              className="flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
            >
              <FileArchive size={16} />
              KMZ
            </button>

          </div>

        </div>

      </header>

      {/* =====================================================
          LAYOUT
      ===================================================== */}

      <div className="mx-auto flex max-w-[1600px]">

        {/* ===================================================
            SIDEBAR
        =================================================== */}

        <aside
          className={`${
            mobileOpen
              ? "block"
              : "hidden"
          } no-print fixed inset-y-16 left-0 z-40 w-64 border-r bg-white p-3 lg:static lg:block lg:min-h-[calc(100vh-4rem)]`}
        >

          {/* NAV */}

          {nav.map(
            ([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  setActive(id);
                  setMobileOpen(false);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                  active === id
                    ? "bg-emerald-50 text-emerald-800"
                    : "hover:bg-slate-100"
                }`}
              >
                <Icon size={18} />
                {label}
              </button>
            )
          )}

          {/* FILES */}

          <div className="mt-6 border-t pt-4">

            <label className="mb-2 block text-xs font-bold uppercase text-slate-500">
              Files
            </label>

            <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm hover:bg-slate-50">

              <Upload size={16} />

              <span className="truncate">
                {dbFile?.name ||
                  "Upload patrol .db"}
              </span>

              <input
                hidden
                type="file"
                accept=".db,.sqlite,.sqlite3"
                onChange={(e) => {
                  const file =
                    e.target.files?.[0];

                  if (file) {
                    loadDb(file);
                  }

                  e.target.value = "";
                }}
              />

            </label>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm hover:bg-slate-50">

              <Upload size={16} />

              <span className="truncate">
                {ptrFile?.name ||
                  "Upload Comptt_PTR .kml/.kmz"}
              </span>

              <input
                hidden
                type="file"
                accept=".kml,.kmz"
                onChange={(e) => {
                  const file =
                    e.target.files?.[0];

                  if (file) {
                    loadPtr(file);
                  }

                  e.target.value = "";
                }}
              />

            </label>

          </div>

          {/* PATROL FILTER */}

          {patrolSummary.length > 0 && (
            <div className="mt-5 border-t pt-4">

              <label className="mb-2 block text-xs font-bold uppercase text-slate-500">
                Patrol filter
              </label>

              <select
                value={selectedPatrol}
                onChange={(e) =>
                  setSelectedPatrol(
                    e.target.value
                  )
                }
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
              >
                <option value="ALL">
                  All patrols
                </option>

                {patrolSummary.map(
                  (patrol) => (
                    <option
                      key={
                        patrol.patrol_id
                      }
                      value={
                        patrol.patrol_id
                      }
                    >
                      {patrol.patrol_id}
                    </option>
                  )
                )}
              </select>

            </div>
          )}

          {/* CLEAR */}

          <button
            onClick={reset}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={16} />
            Clear project
          </button>

        </aside>

        {/* ===================================================
            MAIN
        =================================================== */}

        <main className="min-w-0 flex-1 p-4 lg:p-6">

          {/* ERROR */}

          {error && (
            <div className="no-print mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">

              <div className="font-semibold">
                Error
              </div>

              <div className="mt-1">
                {error}
              </div>

            </div>
          )}

          {/* LOADING */}

          {loading && (
            <div className="no-print mb-4 flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">

              <RefreshCw
                size={18}
                className="animate-spin"
              />

              Reading file… please wait.

            </div>
          )}

          {/* =================================================
              PAGES
          ================================================= */}

          {active === "dashboard" && (
            <Dashboard
              stats={stats}
              dbFile={dbFile}
              ptrFile={ptrFile}
              onDb={loadDb}
              onPtr={loadPtr}
              patrolSummary={
                patrolSummary
              }
            />
          )}

          {active === "data" && (
            <DataPage
              db={db}
              dbInfo={dbInfo}
              search={search}
              setSearch={setSearch}
            />
          )}

          {active === "map" && (
            <MapPage
              features={
                visibleFeatures
              }
              trackFeatures={
                trackFeatures
              }
              patrolSummary={
                patrolSummary
              }
              selectedPatrol={
                selectedPatrol
              }
              setSelectedPatrol={
                setSelectedPatrol
              }
            />
          )}

          {active === "report" && (
            <ReportPage
              db={db}
              dbInfo={dbInfo}
              patrolMetadata={
                patrolMetadata
              }
              patrolSummary={
                patrolSummary
              }
              trackFeatures={
                trackFeatures
              }
            />
          )}

        </main>

      </div>

    </div>
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

function Dashboard({
  stats,
  dbFile,
  ptrFile,
  onDb,
  onPtr,
  patrolSummary,
}) {
  return (
    <div>

      <div className="mb-6">

        <h1 className="text-2xl font-bold">
          Patrol dashboard
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Upload your MSTrIPES SQLite patrol
          database and the original
          Comptt_PTR KML/KMZ to create an
          overlapped GIS dataset.
        </p>

      </div>

      {/* STATS */}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">

        <Card
          title="Database tables"
          value={stats.tables}
          icon={<Database />}
        />

        <Card
          title="Database rows"
          value={stats.rows.toLocaleString()}
          icon={<Table2 />}
        />

        <Card
          title="PTR features"
          value={stats.ptrFeatures.toLocaleString()}
          icon={<Layers />}
        />

        <Card
          title="Patrols"
          value={stats.patrols}
          icon={<Route />}
        />

        <Card
          title="GPS points"
          value={stats.gpsPoints.toLocaleString()}
          icon={<MapPinned />}
        />

      </div>

      {/* UPLOAD */}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">

        <UploadCard
          title="1. Patrol database"
          accept=".db,.sqlite,.sqlite3"
          file={dbFile}
          onChange={onDb}
          text="patrol_backup.db"
        />

        <UploadCard
          title="2. Comptt_PTR boundary"
          accept=".kml,.kmz"
          file={ptrFile}
          onChange={onPtr}
          text="Comptt_PTR(1).kmz"
        />

      </div>

      {/* PATROL SUMMARY */}

      {patrolSummary.length > 0 && (
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">

          <div className="mb-4 flex items-center justify-between">

            <div>

              <h2 className="font-bold">
                Patrol summary
              </h2>

              <p className="text-sm text-slate-500">
                Patrol IDs detected from
                the MSTrIPES tracks table.
              </p>

            </div>

            <Activity
              className="text-emerald-600"
              size={22}
            />

          </div>

          <div className="overflow-auto">

            <table className="min-w-full text-sm">

              <thead>
                <tr className="border-b text-left">

                  <th className="px-3 py-2">
                    Patrol ID
                  </th>

                  <th className="px-3 py-2">
                    Track points
                  </th>

                  <th className="px-3 py-2">
                    Start
                  </th>

                  <th className="px-3 py-2">
                    End
                  </th>

                </tr>
              </thead>

              <tbody>

                {patrolSummary.map(
                  (row) => (
                    <tr
                      key={
                        row.patrol_id
                      }
                      className="border-b last:border-0"
                    >

                      <td className="px-3 py-2 font-medium">
                        {row.patrol_id}
                      </td>

                      <td className="px-3 py-2">
                        {Number(
                          row.track_points ||
                            0
                        ).toLocaleString()}
                      </td>

                      <td className="px-3 py-2">
                        {row.start_date ||
                          "-"}
                      </td>

                      <td className="px-3 py-2">
                        {row.end_date ||
                          "-"}
                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>

        </div>
      )}

      {/* WORKFLOW */}

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">

        <h2 className="font-bold">
          Workflow
        </h2>

        <div className="mt-4 grid gap-3 md:grid-cols-4">

          {[
            "Upload DB",
            "Extract MSTrIPES data",
            "Overlay Comptt_PTR",
            "Download KML/KMZ",
          ].map(
            (x, i) => (
              <div
                className="rounded-xl bg-slate-50 p-4"
                key={x}
              >

                <div className="mb-2 text-xs font-bold text-emerald-700">
                  STEP {i + 1}
                </div>

                <div className="font-semibold">
                  {x}
                </div>

              </div>
            )
          )}

        </div>

      </div>

    </div>
  );
}

/* =========================================================
   CARD
========================================================= */

function Card({
  title,
  value,
  icon,
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">

      <div className="flex items-center justify-between">

        <div>

          <div className="text-sm text-slate-500">
            {title}
          </div>

          <div className="mt-1 text-2xl font-bold">
            {value}
          </div>

        </div>

        <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
          {icon}
        </div>

      </div>

    </div>
  );
}

/* =========================================================
   UPLOAD CARD
========================================================= */

function UploadCard({
  title,
  accept,
  file,
  onChange,
  text,
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">

      <h2 className="font-bold">
        {title}
      </h2>

      <div className="mt-4 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center">

        <Upload
          className="mx-auto text-slate-400"
          size={32}
        />

        <p className="mt-2 break-all text-sm text-slate-500">
          {file?.name ||
            `Choose ${text}`}
        </p>

        <label className="mt-4 inline-flex cursor-pointer rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">

          Choose file

          <input
            hidden
            type="file"
            accept={accept}
            onChange={(e) => {
              const selected =
                e.target.files?.[0];

              if (selected) {
                onChange(selected);
              }

              e.target.value = "";
            }}
          />

        </label>

      </div>

    </div>
  );
}

/* =========================================================
   DATA PAGE
========================================================= */

function DataPage({
  db,
  dbInfo,
  search,
  setSearch,
}) {
  if (!db || !dbInfo) {
    return (
      <Empty title="Upload patrol_backup.db first" />
    );
  }

  const tables = dbInfo.tables || [];

  const filteredTables =
    tables.filter((table) => {
      if (!search) return true;

      const query =
        search.toLowerCase();

      const preview =
        dbInfo.data?.[
          table.name
        ];

      const text = (
        table.name +
        " " +
        JSON.stringify(
          preview?.data || []
        )
      ).toLowerCase();

      return text.includes(query);
    });

  return (
    <div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

        <div>

          <h1 className="text-2xl font-bold">
            Extracted database
          </h1>

          <p className="text-sm text-slate-500">
            {tables.length} tables
            detected.
          </p>

        </div>

        <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-sm">

          <Search size={16} />

          <input
            className="w-full min-w-0 outline-none"
            placeholder="Search table or value…"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
          />

        </div>

      </div>

      {filteredTables.map(
        (table) => {
          const data =
            dbInfo.data?.[
              table.name
            ];

          if (!data) {
            return null;
          }

          return (
            <div
              key={table.name}
              className="mb-6 rounded-2xl bg-white p-4 shadow-sm"
            >

              <div className="mb-3 flex items-center justify-between gap-3">

                <div>

                  <h2 className="font-bold">
                    {table.name}
                  </h2>

                  <p className="text-xs text-slate-500">
                    {table.rowCount?.toLocaleString?.() ||
                      data.data?.length ||
                      0}{" "}
                    total rows
                  </p>

                </div>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  Preview:{" "}
                  {data.data?.length ||
                    0}
                </span>

              </div>

              <div className="overflow-auto">

                <ReportTable
                  columns={data.columns}
                  rows={data.data}
                />

              </div>

            </div>
          );
        }
      )}

    </div>
  );
}

/* =========================================================
   MAP PAGE
========================================================= */

function MapPage({
  features,
  trackFeatures,
  patrolSummary,
  selectedPatrol,
  setSelectedPatrol,
}) {
  return (
    <div className="h-[calc(100vh-8rem)] min-h-[550px]">

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">

        <div>

          <h1 className="text-2xl font-bold">
            Comptt_PTR + Patrol tracks
          </h1>

          <p className="text-sm text-slate-500">
            {trackFeatures.length} patrol
            tracks •{" "}
            {features.length} total map
            features
          </p>

        </div>

        {patrolSummary.length > 0 && (
          <select
            value={selectedPatrol}
            onChange={(e) =>
              setSelectedPatrol(
                e.target.value
              )
            }
            className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm"
          >

            <option value="ALL">
              All patrols
            </option>

            {patrolSummary.map(
              (patrol) => (
                <option
                  key={
                    patrol.patrol_id
                  }
                  value={
                    patrol.patrol_id
                  }
                >
                  {patrol.patrol_id}{" "}
                  (
                  {Number(
                    patrol.track_points ||
                      0
                  ).toLocaleString()}{" "}
                  points)
                </option>
              )
            )}

          </select>
        )}

      </div>

      <div className="h-[calc(100%-4rem)] rounded-2xl bg-white p-2 shadow-sm">

        <MapView
          features={features}
        />

      </div>

    </div>
  );
}

/* =========================================================
   REPORT PAGE
========================================================= */

function ReportPage({
  db,
  dbInfo,
  patrolMetadata,
  patrolSummary,
  trackFeatures,
}) {
  if (!db || !dbInfo) {
    return (
      <Empty title="Upload patrol_backup.db first" />
    );
  }

  const totalRows =
    dbInfo.tables?.reduce(
      (total, table) =>
        total +
        Number(
          table.rowCount || 0
        ),
      0
    ) || 0;

  const totalGpsPoints =
    trackFeatures.reduce(
      (total, track) =>
        total +
        (track.coords?.length ||
          0),
      0
    );

  return (
    <div className="print-report mx-auto max-w-6xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">

      {/* REPORT HEADER */}

      <div className="border-b pb-5 text-center">

        <h1 className="text-2xl font-bold">
          MSTrIPES Implementation
          Monthly Report
        </h1>

        <p className="mt-1">
          Patrol / GPS Data Extraction
          Report
        </p>

        <p className="text-sm text-slate-500">
          Generated from uploaded
          patrol database
        </p>

      </div>

      {/* METRICS */}

      <div className="my-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

        <Metric
          label="Tables"
          value={
            dbInfo.tables?.length ||
            0
          }
        />

        <Metric
          label="Database rows"
          value={totalRows.toLocaleString()}
        />

        <Metric
          label="Patrols"
          value={
            patrolSummary.length
          }
        />

        <Metric
          label="GPS points"
          value={totalGpsPoints.toLocaleString()}
        />

        <Metric
          label="PTR features"
          value={
            "Loaded"
          }
        />

      </div>

      {/* PATROL SUMMARY */}

      {patrolSummary.length > 0 && (
        <section className="mb-8">

          <h2 className="mb-3 text-xl font-bold">
            Patrol Summary
          </h2>

          <div className="overflow-auto">

            <table className="min-w-full border text-sm">

              <thead className="bg-slate-100">

                <tr>

                  <th className="border px-3 py-2 text-left">
                    Patrol ID
                  </th>

                  <th className="border px-3 py-2 text-left">
                    Track Points
                  </th>

                  <th className="border px-3 py-2 text-left">
                    Start Date
                  </th>

                  <th className="border px-3 py-2 text-left">
                    End Date
                  </th>

                </tr>

              </thead>

              <tbody>

                {patrolSummary.map(
                  (row) => (
                    <tr
                      key={
                        row.patrol_id
                      }
                    >

                      <td className="border px-3 py-2">
                        {
                          row.patrol_id
                        }
                      </td>

                      <td className="border px-3 py-2">
                        {Number(
                          row.track_points ||
                            0
                        ).toLocaleString()}
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.start_date ||
                          "-"
                        }
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.end_date ||
                          "-"
                        }
                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>

        </section>
      )}

      {/* P05 PATROL DATA */}

      {patrolMetadata.length > 0 && (
        <section className="mb-8">

          <h2 className="mb-3 text-xl font-bold">
            MSTrIPES Patrol Records
          </h2>

          <div className="overflow-auto">

            <table className="min-w-full border text-sm">

              <thead className="bg-slate-100">

                <tr>

                  <th className="border px-3 py-2">
                    ID
                  </th>

                  <th className="border px-3 py-2">
                    Patrol UID
                  </th>

                  <th className="border px-3 py-2">
                    Area
                  </th>

                  <th className="border px-3 py-2">
                    Type
                  </th>

                  <th className="border px-3 py-2">
                    Method
                  </th>

                  <th className="border px-3 py-2">
                    Distance
                  </th>

                  <th className="border px-3 py-2">
                    Start
                  </th>

                  <th className="border px-3 py-2">
                    End
                  </th>

                  <th className="border px-3 py-2">
                    User
                  </th>

                </tr>

              </thead>

              <tbody>

                {patrolMetadata.map(
                  (row, index) => (
                    <tr
                      key={
                        row.ID ||
                        index
                      }
                    >

                      <td className="border px-3 py-2">
                        {row.ID}
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.Patrol_UID
                        }
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.Patrol_Area
                        }
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.Patrol_Type
                        }
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.Patrol_Method
                        }
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.Patrol_Distance
                        }
                      </td>

                      <td className="border px-3 py-2 whitespace-nowrap">
                        {row.Start_Date}{" "}
                        {row.Start_Time}
                      </td>

                      <td className="border px-3 py-2 whitespace-nowrap">
                        {row.End_Date}{" "}
                        {row.End_Time}
                      </td>

                      <td className="border px-3 py-2">
                        {
                          row.User_Name
                        }
                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>

        </section>
      )}

      {/* DATABASE TABLES */}

      <section>

        <h2 className="mb-3 text-xl font-bold">
          Extracted Database Tables
        </h2>

        {dbInfo.tables?.map(
          (table) => {
            const data =
              dbInfo.data?.[
                table.name
              ];

            if (!data) {
              return null;
            }

            return (
              <div
                key={table.name}
                className="mb-6"
              >

                <div className="mb-2 flex items-center justify-between">

                  <h3 className="font-bold">
                    {table.name}
                  </h3>

                  <span className="text-xs text-slate-500">
                    {Number(
                      table.rowCount ||
                        0
                    ).toLocaleString()}{" "}
                    rows
                  </span>

                </div>

                <div className="overflow-auto">

                  <ReportTable
                    columns={
                      data.columns
                    }
                    rows={
                      data.data
                    }
                  />

                </div>

              </div>
            );
          }
        )}

      </section>

      {/* PRINT */}

      <div className="no-print mt-8 flex gap-2">

        <button
          onClick={() =>
            window.print()
          }
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Print / Save PDF
        </button>

      </div>

    </div>
  );
}

/* =========================================================
   METRIC
========================================================= */

function Metric({
  label,
  value,
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-center">

      <div className="text-xs text-slate-500">
        {label}
      </div>

      <div className="mt-1 font-bold">
        {value}
      </div>

    </div>
  );
}

/* =========================================================
   EMPTY STATE
========================================================= */

function Empty({ title }) {
  return (
    <div className="rounded-2xl bg-white p-12 text-center shadow-sm">

      <Database
        className="mx-auto text-slate-300"
        size={48}
      />

      <h1 className="mt-4 text-xl font-bold">
        {title}
      </h1>

      <p className="mt-1 text-sm text-slate-500">
        Use the upload control in the
        left sidebar.
      </p>

    </div>
  );
}