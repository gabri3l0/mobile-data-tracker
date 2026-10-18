# Mobile data widgets

Show your remaining mobile data on your iPhone with Scriptable.
You need a running usage API. See the [backend guide](../docs/backend.md).

## Preview on your computer

Double-click [dark/preview.html](dark/preview.html). It uses sample data and makes no API calls.

For an image background, open [image/preview.html](image/preview.html).
It uses sample usage data and downloads the background image from the configured URL.

## Image-background design

Use [image/mobile-data-widget.js](image/mobile-data-widget.js) in a Scriptable script
named **Mobile Data Image**, alongside the same **usage-data** helper.
Follow the setup below, choosing **Mobile Data Image** instead of **Mobile Data Dark**.

Change `BACKGROUND_IMAGE_URL` near the top of the widget or HTML preview to use
another image. `BACKGROUND_OVERLAY_OPACITY` controls the dark overlay (default `0.75`).
Edit each file separately when changing the preview and iPhone background.
Images are cropped to fill the card and cached on the iPhone for 24 hours. If loading
fails, the last image for that URL is reused, or the background stays dark.
Usage caching and server retries work the same for both designs.
Sample mode skips the usage API; the image may still need internet on its first load.

## Set up in Scriptable

1. Install Scriptable on your iPhone.
2. Create a script named **usage-data**. Paste [shared/usage-data.js](shared/usage-data.js) into it.
3. Create a script named **Mobile Data Dark**. Paste [dark/mobile-data-widget.js](dark/mobile-data-widget.js) into it.
4. In **Mobile Data Dark**, fill in `SETTINGS`: usage URL, health URL, API key, phone number, and password.
5. Run **Mobile Data Dark** to preview it.

No folders are needed. The dark widget loads **usage-data** automatically.
Keep your credentials private. Set `USE_SAMPLE_DATA = true` to preview without the API;
leave it `false` for real data.

## Add to your home screen

1. Long-press the home screen → **Edit → Add Widget** (or **+**).
2. Add the small **Scriptable** widget.
3. Long-press it → **Edit Widget**.
4. Choose **Mobile Data Dark**, leave **Parameter** empty, and set **When Interacting** to **Run Script**.

Leave **Always Run in App** off and **URL Scheme** unchanged in the script settings.

## What happens when it runs?

- **Saved data is under 30 minutes old:** show it. No server calls.
- **Saved data is 30 minutes old or missing:** check the server, then request usage if ready.
- **Server is unavailable:** keep saved data and show **Iniciando conexión / Reintenta en 2 min**.
- **Usage request fails:** keep saved data and show **No se pudo actualizar**.
- **No saved data:** show the connection message or **No se pudo cargar**.

Running repeatedly does not reset the saved data's age.

## When does it retry?

| Result | Next attempt |
| --- | --- |
| Success | After 30 minutes |
| Server unavailable | After 2 minutes |
| Usage request failed | After 15 minutes |
| Rate limited | After the API's `Retry-After` deadline |

Running before a retry deadline makes no server calls.
The script finishes after each run; it does not keep waiting or looping.
It asks iOS to refresh later, but iOS controls the actual timing. You can also run it manually.

## Dates on the card

- **Actualizado:** when the carrier measured usage.
- **Ejecutado:** when the script last ran, including cached results and failures.

New data updates the card automatically. Code changes must be copied into Scriptable manually.
