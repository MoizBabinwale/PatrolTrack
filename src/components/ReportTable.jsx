import React, { useMemo } from "react";

export default function ReportTable({
  title,
  columns = [],
  rows = [],
}) {
  /*
   * Make sure columns and rows are arrays.
   */
  const safeColumns = Array.isArray(columns)
    ? columns
    : [];

  const safeRows = Array.isArray(rows)
    ? rows
    : [];

  /*
   * Convert column names to lowercase so that
   * Patrol ID / patrol_id / PATROL_ID can be detected.
   */
  const normalizedColumns = safeColumns.map(
    (column) => String(column).toLowerCase()
  );

  const patrolIdIndex =
    normalizedColumns.indexOf("patrol_id");

  const dateIndex =
    normalizedColumns.indexOf("date");

  const timeIndex =
    normalizedColumns.indexOf("time");

  /*
   * Check whether this report contains patrol data.
   */
  const hasPatrolData =
    patrolIdIndex !== -1 &&
    dateIndex !== -1 &&
    timeIndex !== -1;

  /*
   * Convert a date + time into a JavaScript Date.
   */
  function parseDateTime(date, time) {
    if (!date || !time) {
      return null;
    }

    const dateString = String(date).trim();
    const timeString = String(time).trim();

    /*
     * Handles:
     *
     * 2026-09-15
     * 07:30:25
     *
     * and also timestamps where milliseconds exist.
     */
    const parsed = new Date(
      `${dateString}T${timeString}`
    );

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    /*
     * Fallback for DD/MM/YYYY format.
     */
    const parts = dateString.split(/[/-]/);

    if (parts.length === 3) {
      let day;
      let month;
      let year;

      if (parts[0].length === 4) {
        year = Number(parts[0]);
        month = Number(parts[1]) - 1;
        day = Number(parts[2]);
      } else {
        day = Number(parts[0]);
        month = Number(parts[1]) - 1;
        year = Number(parts[2]);
      }

      const fallback = new Date(
        year,
        month,
        day
      );

      const timeParts =
        timeString.split(":");

      fallback.setHours(
        Number(timeParts[0]) || 0,
        Number(timeParts[1]) || 0,
        Number(timeParts[2]) || 0,
        0
      );

      if (!Number.isNaN(fallback.getTime())) {
        return fallback;
      }
    }

    return null;
  }

  /*
   * Format duration as HH:MM:SS.
   */
  function formatDuration(milliseconds) {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0
    ) {
      return "00:00:00";
    }

    const totalSeconds =
      Math.floor(milliseconds / 1000);

    const hours = Math.floor(
      totalSeconds / 3600
    );

    const minutes = Math.floor(
      (totalSeconds % 3600) / 60
    );

    const seconds =
      totalSeconds % 60;

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].join(":");
  }

  /*
   * Calculate patrol duration for every patrol_id.
   */
  const patrolDurations = useMemo(() => {
    if (!hasPatrolData) {
      return {};
    }

    const patrolGroups = {};

    safeRows.forEach((row) => {
      /*
       * Support both arrays and objects.
       */
      const patrolId = Array.isArray(row)
        ? row[patrolIdIndex]
        : row?.patrol_id;

      const date = Array.isArray(row)
        ? row[dateIndex]
        : row?.date;

      const time = Array.isArray(row)
        ? row[timeIndex]
        : row?.time;

      if (
        patrolId === null ||
        patrolId === undefined ||
        patrolId === ""
      ) {
        return;
      }

      const timestamp =
        parseDateTime(date, time);

      if (!timestamp) {
        return;
      }

      const key = String(patrolId);

      if (!patrolGroups[key]) {
        patrolGroups[key] = {
          first: timestamp,
          last: timestamp,
        };
      } else {
        if (
          timestamp <
          patrolGroups[key].first
        ) {
          patrolGroups[key].first =
            timestamp;
        }

        if (
          timestamp >
          patrolGroups[key].last
        ) {
          patrolGroups[key].last =
            timestamp;
        }
      }
    });

    const durations = {};

    Object.entries(patrolGroups).forEach(
      ([patrolId, group]) => {
        durations[patrolId] =
          formatDuration(
            group.last.getTime() -
              group.first.getTime()
          );
      }
    );

    return durations;
  }, [
    safeRows,
    hasPatrolData,
    patrolIdIndex,
    dateIndex,
    timeIndex,
  ]);

  /*
   * Add Total Patrol Time column.
   *
   * It is added only when patrol_id,
   * date and time are available.
   */
  const displayColumns = hasPatrolData
    ? [
        ...safeColumns,
        "Total Patrol Time",
      ]
    : safeColumns;

  return (
    <section className="mb-8">

      {title && (
        <h3 className="mb-3 text-lg font-bold text-slate-800">
          {title}
        </h3>
      )}

      <div className="overflow-x-auto">

        <table className="report-table">

          <thead>
            <tr>
              {displayColumns.map(
                (column, index) => (
                  <th
                    key={`${column}-${index}`}
                  >
                    {column}
                  </th>
                )
              )}
            </tr>
          </thead>

          <tbody>

            {safeRows.map(
              (row, rowIndex) => {

                /*
                 * Convert object rows into values
                 * using the supplied columns.
                 */
                const values =
                  Array.isArray(row)
                    ? row
                    : safeColumns.map(
                        (column) =>
                          row?.[column]
                      );

                let patrolDuration = "";

                if (hasPatrolData) {
                  const patrolId =
                    Array.isArray(row)
                      ? row[patrolIdIndex]
                      : row?.patrol_id;

                  patrolDuration =
                    patrolDurations[
                      String(patrolId)
                    ] || "00:00:00";
                }

                return (
                  <tr key={rowIndex}>

                    {values.map(
                      (
                        value,
                        columnIndex
                      ) => (
                        <td
                          key={columnIndex}
                        >
                          {String(
                            value ?? ""
                          )}
                        </td>
                      )
                    )}

                    {hasPatrolData && (
                      <td>
                        {patrolDuration}
                      </td>
                    )}

                  </tr>
                );
              }
            )}

          </tbody>

        </table>

      </div>

    </section>
  );
}