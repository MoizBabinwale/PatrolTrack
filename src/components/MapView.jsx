import React,{ useEffect, useRef } from "react";
import L from "leaflet";

export default function MapView({ features }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current).setView([21.25, 79.15], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    const group = L.featureGroup().addTo(map);

    features.forEach(f => {
      const latlngs = f.coords.map(p => [p.lat, p.lon]);
      if (f.type === "Polygon") {
        L.polygon(latlngs, { weight: 3, fillOpacity: 0.08 })
          .bindTooltip(f.name)
          .addTo(group);
      } else if (f.type === "LineString") {
        L.polyline(latlngs, { weight: 5 })
          .bindTooltip(f.name)
          .addTo(group);
      } else {
        L.circleMarker(latlngs[0], { radius: 5 })
          .bindTooltip(f.name)
          .addTo(group);
      }
    });

    if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [20,20] });
    return () => map.remove();
  }, [features]);

  return <div ref={ref} className="h-full w-full rounded-xl overflow-hidden" />;
}