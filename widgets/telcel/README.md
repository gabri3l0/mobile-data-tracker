# Telcel

Consulta tus datos móviles directamente desde el iPhone, sin servidor ni computadora.

Elige un diseño: [color sólido](solid.js) o [imagen de fondo](image.js).

1. Instala [Scriptable](https://scriptable.app) en tu iPhone.
2. Crea un script, pega todo el archivo elegido y nómbralo **MiTelcel** o **MiTelcel Imagen**.
3. Ejecútalo e ingresa tu número de 10 dígitos y contraseña de Mi Telcel. Se guardan en Keychain.
4. Agrega un widget **pequeño** de Scriptable y selecciona tu script. En **When Interacting**, elige **Run Script**.

Cambia `backgroundHex` para el color. En el diseño con imagen, ajusta
`backgroundImageUrl` y `backgroundOverlayOpacity`. Usa `useSampleData: true` para
probar sin consultar tu cuenta; la imagen de fondo puede requerir internet.

Ambos diseños comparten la misma cuenta. Para cambiarla, ejecuta el script y elige
**Cambiar datos**. La lectura se guarda 30 minutos y se conserva si falla una
actualización. iOS decide cuándo refrescar el widget.
