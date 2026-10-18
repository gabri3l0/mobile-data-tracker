# Mobile data widgets

Display your remaining mobile data on your iPhone using Scriptable.
Use an existing deployed API, or follow the [backend guide](../docs/backend.md) to run your own.

## Files

- [dark/mobile-data-widget.js](dark/mobile-data-widget.js): draws the dark widget.
- [shared/usage-data.js](shared/usage-data.js): gets usage from the API and keeps a local copy for offline use. Other designs can reuse this file instead of copying the same logic.
- [dark/preview.html](dark/preview.html): double-click to preview the design in your browser with sample data. No installation needed.

## Set up on iPhone

1. Install Scriptable.
2. Create a script named **usage-data** and paste the contents of `shared/usage-data.js`.
3. Create another script named **Mobile Data Dark** and paste the contents of `dark/mobile-data-widget.js`.
4. In **Mobile Data Dark**, fill in `SETTINGS` with your usage endpoint, health endpoint, API key, phone number, and password. Leave `USE_SAMPLE_DATA = false` for real data.
5. Run **Mobile Data Dark** to preview it.

Keep both scripts at the same level in Scriptable; no folders are needed.
Run only **Mobile Data Dark**. It loads **usage-data** automatically.
Keep your configured copy private. For an offline sample preview, set `USE_SAMPLE_DATA = true`.

## Add to the home screen

1. Long-press an empty area on your iPhone home screen.
2. Tap **Edit → Add Widget** (or **+**), search for **Scriptable**, and add the small square widget.
3. Long-press the widget and choose **Edit Widget**.
4. Set **Script** to **Mobile Data Dark**, leave **Parameter** empty, and choose **Run Script** for **When Interacting**.

In the script's settings, leave **Always Run in App** off and **URL Scheme** unchanged.
API URLs belong in the script's `SETTINGS`, not in URL Scheme.
Tapping runs the script and opens its preview; it still reuses fresh cached data.

## Refresh workflow

```text
iOS runs the widget
  → Fresh cache: show saved data without making requests.
  → Cache expired or missing: check server health once.
      → Ready: request usage once, then save and show the result.
      → Unavailable or request failed: show saved data with a warning.
  → Request the next refresh; iOS decides when it actually runs.
```

- Successful fetch: request refresh after **30 minutes**.
- Health check fails: retry after **2 minutes**.
- Usage request fails: retry after **15 minutes**.
- Rate limited: wait for the API's **Retry-After** deadline.

If no saved data exists, show **No se pudo cargar**. Failed updates keep the original
reading date and show **No se pudo actualizar**. No retry loops or tapping are needed.
Refresh times are requests to iOS, not guaranteed intervals.
