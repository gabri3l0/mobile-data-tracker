[English](README.md) | Español

# Mobile Data Tracker

Consulta el consumo de datos de Telcel o Bait desde tu pantalla de inicio. Elige
un widget con color sólido o imagen de fondo, copia un solo script en Scriptable
y consulta directamente a tu operador.

## Primeros pasos

¿No sabes cómo configurar el script? **[Crea tu widget con la vista previa](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/)**: elige tu operador, ajusta el fondo y genera el código completo para pegarlo en Scriptable.

Abre la **[guía de widgets](widgets/README.es.md)** para elegir tu script e
instalarlo en tu iPhone. También explica cómo personalizarlo, cómo se actualiza
y cómo revisar los logs. No necesitas servidor ni computadora.

## Vista previa

Haz clic en una captura para abrir el generador con ese operador y diseño seleccionados.

| Operador | Color sólido | Imagen de fondo | Obtener código |
| --- | :---: | :---: | --- |
| Telcel | [<img src="widgets/screenshots/telcel_solid.png" alt="Telcel · color sólido" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=solid&carrier=telcel) | [<img src="widgets/screenshots/telcel_image.png" alt="Telcel · imagen de fondo" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=image&carrier=telcel) | [Widgets de Telcel](widgets/telcel/) |
| Bait | [<img src="widgets/screenshots/bait_solid.png" alt="Bait · color sólido" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=solid&carrier=bait) | [<img src="widgets/screenshots/bait_image.png" alt="Bait · imagen de fondo" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=image&carrier=bait) | [Widgets de Bait](widgets/bait/) |

## Funciones de los widgets

- Datos restantes y barra de consumo.
- Saldos de Telcel mostrados en MB o GB según la unidad del operador.
- Nombre del paquete, fecha de vencimiento y días restantes.
- Datos de tu cuenta guardados en el Keychain de iOS.
- Temas oscuro, claro y personalizado, con colores de texto y acento.
- Fondos sólidos o con imagen e indicadores de barra, arco o sin gráfico.
- Lecturas guardadas disponibles si falla la actualización.
- Una fecha y hora que indica cuándo se ejecutó el script por última vez.

## Servidor central opcional

La CLI y la API en Python permiten consultar el consumo de ambos operadores, con
claves de API y límites por persona. El seguimiento de cuentas familiares, el
consumo diario, el historial y las tendencias son objetivos a futuro.

Consulta la **[guía del servidor](server/README.es.md)** para ver la instalación,
los comandos de la CLI y los endpoints.

## Licencia

[MIT](LICENSE): puedes usar, modificar y redistribuir el código, incluso con fines
comerciales, siempre que conserves el aviso de derechos de autor y la licencia.
El software se proporciona sin garantía. Las imágenes y los recursos de terceros
conservan sus respectivas licencias.

## Aviso

Este proyecto no es oficial y no está afiliado, respaldado ni patrocinado por el operador.
Usa únicamente cuentas propias o a las que tengas autorización para acceder, y cumple
con las leyes aplicables y los términos del operador.
Este proyecto no distribuye credenciales de cuentas personales, tokens de sesión ni
software propietario del operador.
