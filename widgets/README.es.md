[English](README.md) | Español

# Widgets de datos móviles

Consulta tus datos restantes y la vigencia de tu paquete desde la pantalla de inicio.
Cada widget consulta directamente a Telcel o Bait: copia un solo script, sin servidor
ni computadora. Android aún no es compatible.

| Operador | Diseño | Vista previa | Script | Personalizar |
| --- | --- | --- | --- | --- |
| Telcel | Color sólido | &lt;image&gt; | [solid.js](telcel/solid.js) | [Ajustes](#personalizar) |
| Telcel | Imagen de fondo | &lt;image&gt; | [image.js](telcel/image.js) | [Ajustes](#personalizar) |
| Bait | Color sólido | &lt;image&gt; | [solid.js](bait/solid.js) | [Ajustes](#personalizar) |
| Bait | Imagen de fondo | &lt;image&gt; | [image.js](bait/image.js) | [Ajustes](#personalizar) |

<!-- Reemplaza los marcadores <image> con capturas de cada widget. -->

## Instalar en iPhone

1. Instala [Scriptable](https://scriptable.app) en tu iPhone.
2. Crea un script, pega todo el archivo JS que elegiste y ponle un nombre.
3. Ejecútalo con ▶ y guarda los datos de tu cuenta: Telcel pide tu número de
   10 dígitos y contraseña de Mi Telcel; Bait solo pide tu número de 10 dígitos.
4. Agrega un **widget pequeño de Scriptable** a tu pantalla de inicio. Edita el
   widget, selecciona tu script y elige **Run Script** en **When Interacting**.

Los datos de tu cuenta se guardan en el **Keychain de iOS**. Los dos diseños
comparten una cuenta por operador. Para cambiarla, ejecuta el script y elige
**Cambiar datos**. Al ejecutarlo manualmente verás **Ver widget**, **Cambiar datos**
y **Cancelar**; las actualizaciones automáticas en la pantalla de inicio no muestran menú.

## Cómo se actualiza

El consumo se guarda en un archivo JSON local durante **30 minutos**. Si falla
una consulta, se conserva la lectura anterior y se pausan las solicitudes durante
**15 minutos**. Si el operador limita las solicitudes e indica cuánto esperar,
el widget respeta ese tiempo.

| Ejemplo | Resultado |
| --- | --- |
| Primera ejecución a las 10:00 | Consulta al operador y guarda la lectura. |
| Otra ejecución a las 10:05 | Usa los datos guardados; no consulta al operador. |
| Ejecución a las 10:31 | Consulta al operador porque venció la caché. |
| La consulta falla a las 10:31 | Muestra los datos guardados con un aviso; permite otro intento después de las 10:46. |

El reintento ocurre en la siguiente ejecución después de la espera. **iOS decide
cuándo actualizar**, por lo que no se garantiza una consulta exacta cada 30 minutos.
Las ejecuciones simultáneas aún pueden generar solicitudes duplicadas.

**Última ejecución** indica cuándo se ejecutó el script, incluso si usó datos
guardados o falló. Si no hay una lectura guardada y falla la consulta, muestra un
error. Las imágenes de fondo se guardan por separado durante 24 horas.

## Depuración

Activa `debug: true` en `SETTINGS`, ejecuta el script y revisa la consola de Scriptable.
Los logs muestran las etapas de las solicitudes, códigos HTTP, duración, uso de caché
y tiempos de espera. Omiten datos de cuentas, claves, tokens, URLs y cuerpos de
respuesta. Al terminar, vuelve a ponerlo en `false`.

## Personalizar

Edita el bloque `SETTINGS` señalado al inicio del archivo JS que elegiste:

| Ajuste | Qué cambiar |
| --- | --- |
| `backgroundHex` | Reemplázalo con un color hexadecimal de seis dígitos sin `#`, como `123456`. |
| `backgroundImageUrl` | Solo para el diseño con imagen: reemplázalo con la URL de tu imagen. Usa `""` para un fondo de color sólido. |
| `backgroundOverlayOpacity` | Solo para el diseño con imagen: `0` no oscurece la imagen; `1` la cubre de negro. |

Abre la [vista de color sólido](previews/solid.html) o la [vista con imagen](previews/image.html)
en tu navegador para probar colores, imágenes, operadores y estados con datos de
ejemplo. Copia los valores generados a `SETTINGS`; las vistas previas no editan tu JS.

Para probar datos de ejemplo en Scriptable, activa `useSampleData: true`. Elige
`sampleState`: `success`, `stale`, `error` o `setup`; Bait también admite `throttled`
para los datos de velocidad reducida. Vuelve a poner `useSampleData: false` para
consultar tu consumo real.

## Estructura de carpetas

```text
widgets/
├── telcel/       Scripts independientes de Telcel: solid.js e image.js
├── bait/         Scripts independientes de Bait: solid.js e image.js
├── previews/     Vistas HTML con datos de ejemplo
├── screenshots/  Imágenes de los widgets para la documentación
├── tests/        Pruebas con Scriptable simulado y respuestas de ejemplo
├── README.md     Guía en inglés
└── README.es.md  Guía en español
```
