// src/lib/db.js

import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let SQL_INSTANCE = null;

async function getSQL() {
  if (SQL_INSTANCE) {
    return SQL_INSTANCE;
  }

  SQL_INSTANCE = await initSqlJs({
    locateFile: () => wasmUrl,
  });

  return SQL_INSTANCE;
}

export async function loadDatabase(file) {
  if (!file) {
    throw new Error("No database file selected.");
  }

  const SQL = await getSQL();

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const database = new SQL.Database(bytes);

  if (typeof database.exec !== "function") {
    throw new Error(
      "SQL.js database was not initialized correctly."
    );
  }

  return database;
}

export function isSqliteDatabase(db) {
  return (
    db &&
    typeof db.exec === "function" &&
    typeof db.prepare === "function"
  );
}

export function getTables(db) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const result = db.exec(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);

  if (!result.length) {
    return [];
  }

  return result[0].values.map((row) => row[0]);
}

export function getTableColumns(db, tableName) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const safeName = String(tableName).replace(/"/g, '""');

  const result = db.exec(`
    PRAGMA table_info("${safeName}")
  `);

  if (!result.length) {
    return [];
  }

  return result[0].values.map((row) => ({
    cid: row[0],
    name: row[1],
    type: row[2],
    notnull: row[3],
    defaultValue: row[4],
    primaryKey: row[5],
  }));
}

export function getTableCount(db, tableName) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const safeName = String(tableName).replace(/"/g, '""');

  const result = db.exec(`
    SELECT COUNT(*) AS count
    FROM "${safeName}"
  `);

  if (!result.length) {
    return 0;
  }

  return Number(result[0].values[0][0]);
}

export function readTable(
  db,
  tableName,
  limit = null,
  offset = 0
) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const safeName = String(tableName).replace(/"/g, '""');

  let sql = `
    SELECT *
    FROM "${safeName}"
  `;

  if (limit !== null) {
    sql += `
      LIMIT ${Number(limit)}
      OFFSET ${Number(offset)}
    `;
  }

  const result = db.exec(sql);

  if (!result.length) {
    return {
      columns: [],
      values: [],
    };
  }

  return {
    columns: result[0].columns,
    values: result[0].values,
  };
}

export function inspectSqlite(db) {
  if (!isSqliteDatabase(db)) {
    throw new Error(
      "inspectSqlite received an invalid SQLite database."
    );
  }

  const tables = getTables(db);

  const tableData = {};

  for (const tableName of tables) {
    const columns = getTableColumns(
      db,
      tableName
    );

    const rowCount = getTableCount(
      db,
      tableName
    );

    const preview = readTable(
      db,
      tableName,
      100,
      0
    );

    tableData[tableName] = {
      columns: preview.columns,
      data: preview.values.map((row) => {
        const item = {};

        preview.columns.forEach(
          (column, index) => {
            item[column] = row[index];
          }
        );

        return item;
      }),
      rowCount,
    };
  }

  return {
    tables: tables.map((name) => ({
      name,
      rowCount:
        tableData[name].rowCount,
    })),

    data: tableData,
  };
}

/* =========================================================
   MSTrIPES TRACKS
========================================================= */

  export function getPatrolTracks(db) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const result = db.exec(`
    SELECT
      id,
      patrol_id,
      date,
      time,
      latitude,
      longitude,
      altitude,
      accuracy,
      no_of_satellites
    FROM tracks
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
    ORDER BY patrol_id, id
  `);

  if (!result.length) {
    return [];
  }

  const columns = result[0].columns;

  return result[0].values.map((row) => {
    const item = {};

    columns.forEach((column, index) => {
      item[column] = row[index];
    });

    return item;
  });
}

/* =========================================================
   P05 PATROL
========================================================= */

export function getPatrolMetadata(db) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const result = db.exec(`
    SELECT *
    FROM P05_Patrol
    ORDER BY ID
  `);

  if (!result.length) {
    return [];
  }

  const columns = result[0].columns;

  return result[0].values.map((row) => {
    const item = {};

    columns.forEach(
      (column, index) => {
        item[column] = row[index];
      }
    );

    return item;
  });
}

/* =========================================================
   PATROL SUMMARY
========================================================= */

export function getPatrolIds(db) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const result = db.exec(`
    SELECT
      patrol_id,
      COUNT(*) AS track_points,
      MIN(date) AS start_date,
      MAX(date) AS end_date
    FROM tracks
    WHERE patrol_id IS NOT NULL
    GROUP BY patrol_id
    ORDER BY start_date, patrol_id
  `);

  if (!result.length) {
    return [];
  }

  const columns = result[0].columns;

  return result[0].values.map((row) => {
    const item = {};

    columns.forEach(
      (column, index) => {
        item[column] = row[index];
      }
    );

    return item;
  });
}

/* =========================================================
   SINGLE PATROL TRACK
========================================================= */

export function getTracksForPatrol(
  db,
  patrolId
) {
  if (!isSqliteDatabase(db)) {
    throw new Error("Invalid SQLite database object.");
  }

  const statement = db.prepare(`
    SELECT
      id,
      patrol_id,
      date,
      time,
      latitude,
      longitude,
      altitude,
      accuracy,
      no_of_satellites
    FROM tracks
    WHERE patrol_id = ?
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
    ORDER BY id
  `);

  statement.bind([patrolId]);

  const rows = [];

  while (statement.step()) {
    rows.push(
      statement.getAsObject()
    );
  }

  statement.free();

  return rows;
}