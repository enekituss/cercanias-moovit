#!/usr/bin/env python3
"""Build a date-aware Bilbao Cercanias subset from the Renfe/NAP GTFS ZIP."""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

DEFAULT_URL = "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip"
LINES = {"C1", "C2", "C3"}
WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def fetch_zip(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Cercanias-Moovit/1.0 (GTFS builder)"})
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = response.read()
    if not payload.startswith(b"PK"):
        raise RuntimeError("La URL GTFS no ha devuelto un ZIP válido.")
    return payload


def rows(archive: zipfile.ZipFile, name: str):
    with archive.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        for row in csv.DictReader(text):
            yield {(key or "").strip(): (value or "").strip() for key, value in row.items()}


def build(source_bytes: bytes, output_dir: str, source_label: str):
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as archive:
        required = {"routes.txt", "calendar.txt", "trips.txt", "stops.txt", "stop_times.txt"}
        missing = required.difference(archive.namelist())
        if missing:
            raise RuntimeError("Al GTFS le faltan archivos obligatorios: " + ", ".join(sorted(missing)))

        all_routes = {item["route_id"]: item for item in rows(archive, "routes.txt")}
        selected_routes = {
            route_id: route for route_id, route in all_routes.items()
            if route.get("route_short_name", "").strip() in LINES
            and "Abando" in route.get("route_long_name", "")
            and route_id.startswith("60T")
        }
        if not selected_routes:
            raise RuntimeError("No se han encontrado las rutas de Bilbao C1, C2 y C3 (Abando).")
        route_ids = set(selected_routes)

        calendar = {}
        for item in rows(archive, "calendar.txt"):
            service_id = item.get("service_id", "")
            start = item.get("start_date", "")
            if len(start) != 8:
                continue
            date = f"{start[:4]}-{start[4:6]}-{start[6:]}"
            weekday = next((name for name in
                ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
                if item.get(name) == "1"), None)
            calendar[service_id] = {"date": date, "weekday": weekday}

        stops_by_id = {}
        for stop in rows(archive, "stops.txt"):
            stop_id = stop.get("stop_id", "")
            if not stop_id:
                continue
            stops_by_id[stop_id] = {
                "id": stop_id,
                "name": stop.get("stop_name", ""),
                "lat": float(stop["stop_lat"]) if stop.get("stop_lat") else None,
                "lon": float(stop["stop_lon"]) if stop.get("stop_lon") else None
            }

        trips = []
        trip_ids = set()
        for trip in rows(archive, "trips.txt"):
            route_id = trip.get("route_id", "")
            if route_id not in route_ids:
                continue
            service_id = trip.get("service_id", "")
            service_day = calendar.get(service_id)
            if not service_day:
                continue
            trip_id = trip.get("trip_id", "")
            match = re.search(r"(\d+)C([123])$", trip_id)
            if not match:
                continue
            route = selected_routes[route_id]
            route_prefix = route.get("route_long_name", "").split("-")[0]
            direction = "outbound" if "Abando" in route_prefix else "inbound"
            trips.append({
                "trip_id": trip_id,
                "service_id": service_id,
                "date": service_day["date"],
                "circulation": match.group(1),
                "line": "C" + match.group(2),
                "route_id": route_id,
                "direction": direction,
                "block_id": trip.get("block_id", "")
            })
            trip_ids.add(trip_id)

        if not trips:
            raise RuntimeError("El GTFS no contiene circulaciones de Bilbao en sus fechas de servicio.")

        stop_times = collections.defaultdict(list)
        for stop_time in rows(archive, "stop_times.txt"):
            trip_id = stop_time.get("trip_id", "")
            if trip_id not in trip_ids:
                continue
            stop_times[trip_id].append([
                stop_time.get("stop_id", ""),
                stop_time.get("arrival_time", ""),
                stop_time.get("departure_time", ""),
                int(stop_time.get("stop_sequence", "0") or "0")
            ])

        by_date = collections.defaultdict(list)
        used_stops = set()
        for trip in trips:
            sequence = sorted(stop_times.get(trip["trip_id"], []), key=lambda item: item[3])
            if len(sequence) < 2:
                continue
            used_stops.update(item[0] for item in sequence)
            trip["origin_id"] = sequence[0][0]
            trip["destination_id"] = sequence[-1][0]
            trip["departure"] = sequence[0][2] or sequence[0][1]
            trip["arrival"] = sequence[-1][1] or sequence[-1][2]
            trip["stops"] = [[item[0], item[1], item[2]] for item in sequence]
            by_date[trip["date"]].append(trip)

        if not by_date:
            raise RuntimeError("No se han podido construir los horarios por fecha.")

        os.makedirs(os.path.join(output_dir, "days"), exist_ok=True)
        days_dir = os.path.join(output_dir, "days")
        for filename in os.listdir(days_dir):
            if filename.endswith(".json"):
                os.remove(os.path.join(days_dir, filename))

        dates = []
        for date in sorted(by_date):
            date_obj = dt.date.fromisoformat(date)
            services = sorted(by_date[date], key=lambda item: (item["departure"], item["line"], item["circulation"]))
            line_counts = collections.Counter(service["line"] for service in services)
            if date_obj.weekday() >= 5:
                service_type = "Fin de semana"
            elif len(services) < 287:
                service_type = "Festivo / servicio especial"
            else:
                service_type = "Laborable"
            dates.append({
                "date": date,
                "weekday": WEEKDAYS_ES[date_obj.weekday()],
                "service_type": service_type,
                "total": len(services),
                "by_line": {line: line_counts[line] for line in ["C1", "C2", "C3"]}
            })
            compact = [{
                "trip_id": service["trip_id"],
                "circulation": service["circulation"],
                "line": service["line"],
                "route_id": service["route_id"],
                "direction": service["direction"],
                "block_id": service["block_id"],
                "origin_id": service["origin_id"],
                "destination_id": service["destination_id"],
                "departure": service["departure"],
                "arrival": service["arrival"],
                "stops": service["stops"]
            } for service in services]
            day_payload = {
                "date": date,
                "service_type": service_type,
                "service_count": len(services),
                "services": compact
            }
            with open(os.path.join(days_dir, date + ".json"), "w", encoding="utf-8") as handle:
                json.dump(day_payload, handle, ensure_ascii=False, separators=(",", ":"))

        station_payload = [stops_by_id[stop_id] for stop_id in sorted(used_stops) if stop_id in stops_by_id]
        with open(os.path.join(output_dir, "stations.json"), "w", encoding="utf-8") as handle:
            json.dump(station_payload, handle, ensure_ascii=False, separators=(",", ":"))

        payload = {
            "meta": {
                "title": "Renfe Cercanías Bilbao C1, C2 y C3",
                "source": "Renfe Cercanías / NAP GTFS",
                "source_url": source_label,
                "attribution": "Powered by MITRAMS",
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "valid_from": dates[0]["date"],
                "valid_to": dates[-1]["date"],
                "total_services": sum(item["total"] for item in dates),
                "demo": False,
                "note": "block_id no identifica una rotación continua de material en este feed. Los enlaces entre circulaciones se estiman por terminal y horario."
            },
            "dates": dates,
            "routes": [{
                "route_id": route_id,
                "line": route["route_short_name"],
                "long_name": route["route_long_name"].strip(),
                "color": route.get("route_color", "")
            } for route_id, route in selected_routes.items()]
        }
        with open(os.path.join(output_dir, "calendar.json"), "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

        return {
            "days": len(dates),
            "services": sum(item["total"] for item in dates),
            "stations": len(station_payload),
            "line_totals": {line: sum(item["by_line"][line] for item in dates) for line in ["C1", "C2", "C3"]},
            "valid_from": dates[0]["date"],
            "valid_to": dates[-1]["date"]
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="data")
    parser.add_argument("--source-zip", default=os.environ.get("GTFS_LOCAL_ZIP"))
    parser.add_argument("--url", default=os.environ.get("GTFS_URL", DEFAULT_URL))
    args = parser.parse_args()
    if args.source_zip:
        with open(args.source_zip, "rb") as handle:
            source_bytes = handle.read()
        label = "archivo GTFS proporcionado localmente"
    else:
        print("Descargando GTFS estático:", args.url, flush=True)
        source_bytes = fetch_zip(args.url)
        label = args.url
    result = build(source_bytes, args.output_dir, label)
    print("GTFS Bilbao generado:", json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("ERROR al construir GTFS:", str(exc), file=sys.stderr)
        sys.exit(1)
