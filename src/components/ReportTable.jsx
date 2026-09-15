import React from "react";

export default function ReportTable({
  title,
  columns = [],
  rows = [],
}) {
  /*
   * Make sure columns is always an array.
   */
  const safeColumns = Array.isArray(columns)
    ? columns
    : [];

  /*
   * Make sure rows is always an array.
   */
  const safeRows = Array.isArray(rows)
    ? rows
    : [];

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
              {safeColumns.map((column, index) => (
                <th key={`${column}-${index}`}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>

            {safeRows.map((row, rowIndex) => {

              /*
               * Your DB data can be either:
               *
               * Array:
               * [1, "2026-09-15", 21.1, 79.1]
               *
               * OR object:
               * {
               *   id: 1,
               *   date: "2026-09-15",
               *   latitude: 21.1,
               *   longitude: 79.1
               * }
               */

              const values = Array.isArray(row)
                ? row
                : safeColumns.map(
                    (column) => row?.[column]
                  );

              return (
                <tr key={rowIndex}>

                  {values.map((value, columnIndex) => (
                    <td key={columnIndex}>
                      {String(value ?? "")}
                    </td>
                  ))}

                </tr>
              );
            })}

          </tbody>

        </table>

      </div>

    </section>
  );
}