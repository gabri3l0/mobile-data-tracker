# Widgets para iPhone

Consulta tu consumo directamente con el operador. Cada diseño es un solo archivo
para copiar en Scriptable, sin servidor, computadora ni scripts adicionales.

| Operador | Color sólido | Imagen de fondo | Instalación |
| --- | --- | --- | --- |
| Telcel | [solid.js](telcel/solid.js) | [image.js](telcel/image.js) | [Guía Telcel](telcel/README.md) |
| Bait | [solid.js](bait/solid.js) | [image.js](bait/image.js) | [Guía Bait](bait/README.md) |

Tus datos se guardan en Keychain. Telcel pide número y contraseña; Bait solo pide
el número. Los dos diseños de cada operador comparten la misma cuenta.

## Personalizar

Cambia `backgroundHex` para el color. En el diseño con imagen, ajusta
`backgroundImageUrl` y `backgroundOverlayOpacity`.

Prueba colores y fondos en las vistas de [color sólido](previews/solid.html) e
[imagen](previews/image.html). Abre el HTML en tu navegador y elige operador y
estado. Solo usan datos de ejemplo; la imagen puede requerir internet. Copia los
valores elegidos en `SETTINGS` de tu script: el HTML no modifica los archivos.

También puedes usar `useSampleData: true` para probar en Scriptable. En Bait,
`sampleState: "throttled"` muestra el balance de velocidad reducida.

## Actualización

La lectura se guarda 30 minutos. Si falla una consulta, se conserva la anterior y
se reintenta después de 15 minutos, o cuando indique el operador si limita las
consultas. iOS decide cuándo refrescar el widget.

Para cambiar tu cuenta, ejecuta el script y elige **Cambiar datos**.

## Pruebas

Desde la raíz del repositorio: `node --test widgets/tests/*.test.cjs`.
