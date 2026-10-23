[English](README.md) | Español

# Servidor central

CLI en Python y servicio FastAPI para consultar el consumo de datos móviles de
**Telcel y Bait**. Ambos operadores funcionan con la CLI y la API de consumo,
con una cuenta por solicitud.

El objetivo a futuro es dar seguimiento a cuentas familiares, consumo diario,
historial y tendencias. Las cuentas guardadas, la recopilación programada y el
análisis de consumo aún no están implementados.

## Estructura de carpetas

```text
server/
├── src/
│   ├── api/         Aplicación, rutas, esquemas, autenticación, límites y errores
│   ├── providers/
│   │   ├── bait/       Proveedor, parser y configuración de Bait
│   │   └── telcel/     Proveedor, parser y configuración de Telcel
│   ├── client.py    Selección de operador y cliente de consumo compartido
│   ├── models.py    Nombres de operadores y tipo de consumo normalizado
│   └── exceptions.py  Errores compartidos de los operadores
├── tests/           Pruebas de regresión con respuestas simuladas
├── scripts/         Generación de claves de API
├── bruno/           Plantilla para pruebas manuales de la API
├── main.py          Punto de entrada de la CLI
├── .env.example     Plantilla de configuración
├── pyproject.toml   Dependencias y ajustes del proyecto
└── uv.lock          Versiones de dependencias fijadas
```

## Funciones actuales

- Nombre del paquete, vencimiento, días restantes y fecha de la lectura.
- Datos totales, usados y restantes con porcentajes; la CLI de Telcel conserva la unidad de cada lectura.
- CLI y API HTTP que usan el mismo cliente de operadores.
- Datos de alta velocidad de Bait con cambio automático a datos de velocidad reducida.
- Claves de API y límites de consumo por persona.
- Errores de API sin datos sensibles; no se guardan credenciales, tokens ni lecturas.
- Los logs de diagnóstico omiten credenciales, tokens, URLs de solicitudes y cuerpos de respuesta.
- Intento de cierre de sesión SSO después de cada consulta de Telcel, incluso si falla.

Telcel lee cada componente `data-unit` de datos totales, usados y disponibles.
Admite separadores de miles como `1,000` y usa 1000 MB = 1 GB para calcular
porcentajes con unidades distintas. Las respuestas antiguas sin unidad usan GB.

## Límites

- **Dos intentos de consulta por persona en una ventana móvil de 15 minutos**, entre todas sus cuentas e IPs.
- Los fallos del operador cuentan; los datos inválidos, claves inválidas y consultas de salud no cuentan.
- Al superar el límite se devuelve `429` con `Retry-After` en segundos.
- Los contadores se reinician al reiniciar el servidor y son por proceso. Ejecuta un solo proceso del servidor.
- Las operaciones de red con el operador tienen un tiempo de espera de 30 segundos; no es un límite total por solicitud.
- El cierre de sesión SSO espera hasta 5 segundos; si falla, se registra sin invalidar la lectura.

## Claves de API

Desde `server/`, ejecuta `uv run python scripts/create_token.py` para generar una
clave distinta por persona y agrégala a `.env`:

```dotenv
API_KEYS='{"alice":"<alice-key>","bob":"<bob-key>"}'
```

Se requiere una configuración válida de `API_KEYS` para iniciar el servidor.
Envía `Authorization: Bearer <key>` con las solicitudes de consumo. Cada clave
puede consultar distintas cuentas de operadores.

Las claves no caducan. Reinicia el servidor después de agregar, reemplazar o
eliminar claves. Mantén las credenciales privadas y usa HTTPS al alojar la API.

## Instalación

Requiere Python 3.11+ y UV. Desde la raíz del repositorio:

```bash
cd server
uv sync
cp .env.example .env
```

Configura `TELCEL_USERNAME`, `TELCEL_PASSWORD` y `TELCEL_BASIC_AUTH` en tu `.env`
local; consulta la [plantilla](.env.example). Usa la credencial Basic codificada,
sin el prefijo `Basic`. Las URLs y el scope de Telcel se definen en
`src/providers/telcel/config.py`.

Para Bait, configura `BAIT_SERVICE_KEY` y, si usas la CLI, `BAIT_PHONE`. La API
recibe el número en el campo `username` de cada solicitud. Las URLs de Bait se
definen en `src/providers/bait/config.py`.

Ejecuta los siguientes comandos desde `server/`.

## Comandos

| Comando | Propósito |
| --- | --- |
| `uv run python main.py --carrier telcel` | Muestra el consumo de la cuenta Telcel configurada en `.env`. |
| `uv run python main.py --carrier bait` | Muestra el consumo de `BAIT_PHONE` usando `BAIT_SERVICE_KEY`. |
| `uv run python scripts/create_token.py` | Genera una clave de API. |
| `uv run uvicorn src.api.app:app --reload` | Inicia la API localmente. |
| `uv run pytest -v` | Ejecuta pruebas sin credenciales reales ni solicitudes a operadores. |

La CLI usa Telcel por defecto si omites `--carrier`. Lee los ajustes del operador
seleccionado desde `.env` y no necesita una clave de API del servidor. Los límites
de la API solo aplican a solicitudes HTTP. Usa `LOG_LEVEL=DEBUG` para ver logs
detallados de la CLI.

La salida de la CLI de Telcel conserva el valor y la unidad de cada lectura.
Estos son sus campos de datos (también incluye paquete, fechas y porcentajes):

```json
{
  "total_data": 7.0,
  "total_unit": "GB",
  "used_data": 6.0,
  "used_unit": "GB",
  "remaining_data": 1000.0,
  "remaining_unit": "MB"
}
```

La CLI de Bait usa `total_gb`, `used_gb` y `remaining_gb`. Desde Python puedes
pedir los valores y unidades de Telcel con
`tracker.get_usage_data(preserve_units=True)`; por defecto devuelve los saldos en GB.

## Endpoints

URL base local: `http://127.0.0.1:8000`.

| Método | Ruta | Clave de API | Propósito |
| --- | --- | --- | --- |
| GET | `/health` | No | Estado del servidor; no consulta al operador. |
| POST | `/v1/usage` | Sí | Consumo actual del operador y la cuenta seleccionados. |
| GET | `/docs` | No | Documentación interactiva de la API. |
| GET | `/redoc` | No | Documentación alternativa de la API. |
| GET | `/openapi.json` | No | Esquema OpenAPI. |

Envía un cuerpo JSON a `POST /v1/usage`. Ambos operadores requieren el número de
teléfono en `username`. Telcel también requiere contraseña:

```json
{
  "carrier": "telcel",
  "username": "<phone-number>",
  "password": "<carrier-password>"
}
```

Bait usa la clave de servicio del servidor y no requiere contraseña:

```json
{
  "carrier": "bait",
  "username": "<phone-number>"
}
```

La API HTTP devuelve los saldos de ambos operadores en GB mediante `total_gb`,
`used_gb` y `remaining_gb`. También incluye los detalles del paquete, fechas,
porcentajes y `data_tier` (`high_speed` o `throttled` para Bait, `null` para Telcel).
`last_updated` es la hora de la lectura del operador en Telcel, o la hora de
finalización de la consulta en UTC en Bait, porque Bait no proporciona una fecha
y hora de medición.
Abre `/docs` para ver el esquema completo y ejemplos. Haz clic en **Authorize**
e ingresa tu clave sin el prefijo `Bearer` para probar una solicitud.

Errores: `401` clave inválida, `422` datos de entrada inválidos, `429` límite de
solicitudes, `502` fallo del operador o del parser, `504` tiempo de espera agotado
con el operador y `500` fallo inesperado.

## Bruno

Importa `http://127.0.0.1:8000/openapi.json` y luego importa
[bruno/local.env.example.json](bruno/local.env.example.json) como entorno.
Completa `username`, `password` y `api_key` localmente y márcalos como secretos.
Configura `carrier` como `telcel` o `bait` y usa el número de teléfono en `username`.
El entorno usa `telcel` por defecto.
Usa `{{base_url}}/v1/usage` con el token bearer `{{api_key}}` y este cuerpo:

```json
{
  "carrier": "{{carrier}}",
  "username": "{{username}}",
  "password": "{{password}}"
}
```

Para Bait, configura `carrier` como `bait`; omite `password` o déjalo vacío.
La clave de servicio permanece en el entorno del servidor. Mantén las credenciales
en blanco en la plantilla del repositorio. Vuelve a importar el esquema cuando
cambie la API.

## Agregar un operador

Agrega sus archivos `provider.py`, `parser.py` y `config.py` en `src/providers/<name>/`.
El proveedor implementa `get_usage_data()` y `close()`, gestiona su autenticación y
devuelve los campos compartidos de `UsageData`. Agrega la selección del operador en
el cliente compartido y en `CarrierName`, y agrega pruebas.

## Datos disponibles en Bait

Bait muestra los datos de alta velocidad mientras haya disponibles y luego los de
velocidad reducida, identificados con `data_tier`. Convierte MB a GB usando 1024 y
usa la hora de consulta en UTC como `last_updated`. Se excluyen minutos y mensajes.
