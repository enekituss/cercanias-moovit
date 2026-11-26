# Cercanías Moovit · Bilbao

Web independiente para consultar números de circulación de Cercanías Bilbao, enlazar los siguientes servicios del mismo material y simular la propagación de retrasos.

## Funciones

- Búsqueda por número de circulación.
- Búsqueda por estación, hora de salida y línea.
- Cadena de siguientes servicios mediante el campo \`nextServiceId\`.
- Simulación de retrasos con margen mínimo de inversión y recuperación configurable.
- Importación y exportación de horarios en JSON.
- Persistencia local de los datos importados en el navegador.

## Datos incluidos

El repositorio comienza con un ejemplo de dos servicios C1 enlazados:

- 26137: Bilbao-Abando 13:25 → Santurtzi 13:49.
- 26140: Santurtzi 14:03 → Bilbao-Abando 14:27.

Este ejemplo procede de la información facilitada para el proyecto. Está marcado como demostración y **no es un horario completo ni una fuente oficial de Renfe**. No se incluyen datos inventados para C2 o C3.

## Publicar con GitHub Pages

1. Abre Settings del repositorio.
2. Entra en Pages.
3. En Build and deployment, selecciona **GitHub Actions** como Source.
4. El workflow de \`.github/workflows/deploy.yml\` publicará la web al hacer push en \`main\`.

La web se servirá en:

\`https://enekituss.github.io/cercanias-moovit/\`

## Formato de horarios JSON

Importa un archivo JSON con este esquema:

\`\`\`json
{
  "meta": {
    "title": "Horarios Cercanías Bilbao",
    "demo": false,
    "source": "Fuente y fecha de actualización"
  },
  "stations": ["Bilbao-Abando", "Santurtzi"],
  "services": [
    {
      "id": "26137",
      "line": "C1",
      "origin": "Bilbao-Abando",
      "destination": "Santurtzi",
      "departure": "13:25",
      "arrival": "13:49",
      "trainset": "unidad-01",
      "nextServiceId": "26140",
      "turnaroundMin": 3,
      "source": "Fuente del horario"
    },
    {
      "id": "26140",
      "line": "C1",
      "origin": "Santurtzi",
      "destination": "Bilbao-Abando",
      "departure": "14:03",
      "arrival": "14:27",
      "trainset": "unidad-01",
      "nextServiceId": "",
      "turnaroundMin": 3,
      "source": "Fuente del horario"
    }
  ]
}
\`\`\`

### Campos principales

| Campo | Descripción |
|---|---|
| \`id\` | Número de circulación |
| \`line\` | C1, C2 o C3 |
| \`origin\` / \`destination\` | Estaciones de origen y destino |
| \`departure\` / \`arrival\` | Horas programadas en formato HH:MM |
| \`trainset\` | Identificador común del material, si se conoce |
| \`nextServiceId\` | Número de la siguiente circulación del mismo tren |
| \`turnaroundMin\` | Tiempo mínimo de inversión en minutos |
| \`source\` | Procedencia del dato |

La relación entre servicios debe confirmarse con información de explotación o seguimiento fiable. No se debe enlazar por proximidad horaria solamente.

## Cómo se calcula el retraso

La simulación parte del retraso que se introduce a la llegada de la circulación seleccionada. Para cada servicio posterior:

1. Calcula la hora real estimada de llegada del servicio anterior.
2. Añade el tiempo mínimo de inversión configurado.
3. Compara ese resultado con la salida programada del siguiente servicio.
4. Si no queda margen suficiente, traslada la demora a la salida y llegada siguientes.
5. Aplica, si se configura, los minutos de recuperación en marcha.

Es una estimación simplificada. No contempla cruces, regulación, incidencias, cambios de material ni decisiones operativas de Renfe.

## Tecnologías

HTML, CSS y JavaScript sin frameworks ni servidor. Los datos importados se guardan en el almacenamiento local del navegador.
