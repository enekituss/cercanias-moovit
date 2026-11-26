# Cercanías Moovit · Bilbao

Buscador de circulaciones oficiales de Renfe Cercanías para C1 (Santurtzi), C2 (Muskiz) y C3 (Orduña/Llodio), con calendario por fecha, consulta de paradas y datos GTFS-RT.

## Funciones

- Selector de fecha que aplica el calendario GTFS del día (laborable, fin de semana o servicio especial).
- Búsqueda por número de circulación.
- Búsqueda de la siguiente salida desde cualquiera de las estaciones y a partir de una hora.
- Itinerario y horario de paso de cada circulación.
- Consulta de posiciones y actualizaciones de viaje de Renfe en tiempo real.
- Simulador de retrasos con tiempo mínimo de inversión y recuperación configurable.
- Cálculo de una posible continuidad del tren en la terminal y confirmación manual de enlaces.

## Datos horarios

El workflow descarga el GTFS estático de Renfe Cercanías disponible a través del feed NAP 1130 replicado por Transitland y extrae las seis rutas de Bilbao (C1, C2 y C3 en ambos sentidos). Genera un fichero por fecha en data/days/, junto con data/calendar.json y data/stations.json.

El ZIP aportado para el desarrollo (actualización 24/11/2026) contiene 7.971 circulaciones para el periodo 24/11/2026–23/12/2026:
- C1: 2.580 circulaciones.
- C2: 2.481 circulaciones.
- C3: 2.910 circulaciones.

Los datos servidos por la web dependen de la versión GTFS que descargue cada despliegue. El selector usa las fechas reales presentes en calendar.txt, no una suposición basada únicamente en el día de la semana.

## Tiempo real

Renfe publica GTFS-RT y una representación JSON equivalente de:
- vehicle_positions.json: posición GPS, estado, estación y etiqueta/andén del vehículo.
- trip_updates.json: retrasos, cancelaciones y cambios de horario por viaje.

Los feeds se consultan desde el navegador cada 20 segundos. La asociación con el horario se realiza mediante trip_id. Si el navegador no puede acceder a los feeds, los horarios estáticos siguen disponibles.

## Rotación y propagación del retraso

El campo GTFS block_id de la fuente utilizada no agrupa los servicios de una misma composición (aparece un valor diferente para cada viaje). Por eso el sistema no presenta una relación física como si fuera oficial. Propone el siguiente servicio que sale desde la terminal de llegada, en la misma línea y tras el tiempo mínimo de inversión configurado. El usuario puede confirmar o cambiar el enlace; esa confirmación se guarda localmente en el navegador.

La simulación:
1. Parte del retraso de llegada introducido o copiado desde GTFS-RT.
2. Calcula si queda margen para invertir la marcha antes de la salida siguiente.
3. Traslada la demora a las circulaciones enlazadas.
4. Aplica la recuperación en marcha configurada.

Es una estimación, no una predicción operativa de Renfe: no contempla cruces, regulación, incidencias, cambios de composición ni decisiones del centro de control.

## Actualización automática

.github/workflows/deploy.yml descarga y reconstruye los datos:
- Al hacer push a main.
- Semanalmente.
- Manualmente desde GitHub Actions.

El workflow intenta guardar los datos horarios generados en el repositorio y desplegar GitHub Pages.

## Publicación

En Settings → Pages, selecciona **GitHub Actions** como Source. La web se publica en:

https://enekituss.github.io/cercanias-moovit/

## Fuentes y atribución

- Renfe Data — Ubicación de vehículos: https://data.renfe.com/dataset/ubicacion-vehiculos
- Renfe Data — Horarios de viaje: https://data.renfe.com/es/dataset/horarios-viaje-cercanias
- NAP — Conjunto de datos Cercanías Renfe: https://nap.transportes.gob.es/ConjuntoDato/Detail/929
- Feed estático replicado: https://gtfs-source-feeds.transit.land/es-nap-1130.zip

Atribución: **Powered by MITRAMS** (Ministerio de Transportes y Movilidad Sostenible). Proyecto independiente, no afiliado a Renfe ni a Moovit.
