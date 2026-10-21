# Bait

Consulta tus datos móviles directamente desde el iPhone, sin servidor ni computadora.

Elige un diseño: [color sólido](solid.js) o [imagen de fondo](image.js).

1. Instala [Scriptable](https://scriptable.app) en tu iPhone.
2. Crea un script, pega todo el archivo elegido y nómbralo **MiBait** o **MiBait Imagen**.
3. Ejecútalo e ingresa tu número Bait de 10 dígitos. Se guarda en Keychain; no requiere contraseña.
4. Agrega un widget **pequeño** de Scriptable y selecciona tu script. En **When Interacting**, elige **Run Script**.

Cambia `backgroundHex` para el color. En el diseño con imagen, ajusta
`backgroundImageUrl` y `backgroundOverlayOpacity`. Usa `useSampleData: true` para
probar sin consultar tu cuenta; `sampleState: "throttled"` muestra velocidad
reducida. La imagen de fondo puede requerir internet.

Ambos diseños comparten la misma cuenta. Para cambiar el número, ejecuta el script
y elige **Cambiar datos**. La lectura se guarda 30 minutos y se conserva si falla
una actualización. iOS decide cuándo refrescar el widget.

Se muestran primero los datos de alta velocidad y, al agotarse, los de velocidad
reducida. Los MB se convierten usando 1024 por GB. **Consultado** indica cuándo
se obtuvo la lectura; Bait no entrega una hora de medición.
