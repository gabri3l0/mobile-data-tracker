> [!NOTE]
> Para ver la versión en español, [haz clic aquí](README.es.md).

# Mobile Data Widgets

Check your remaining mobile data and plan expiration from your home screen.
Each widget connects directly to Telcel or Bait: copy one script, with no server
or computer needed. Android is not supported yet.

| Carrier | Design | Preview | Script | Customize | Generate code |
| --- | --- | --- | --- | --- | --- |
| Telcel | Solid color | [<img src="screenshots/telcel_solid.png" alt="Telcel · solid color" width="120">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=solid&carrier=telcel) | [solid.js](telcel/solid.js) | [Settings](#customize) | [Create widget](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=solid&carrier=telcel) |
| Telcel | Background image | [<img src="screenshots/telcel_image.png" alt="Telcel · background image" width="120">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=image&carrier=telcel) | [image.js](telcel/image.js) | [Settings](#customize) | [Create widget](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=image&carrier=telcel) |
| Bait | Solid color | [<img src="screenshots/bait_solid.png" alt="Bait · solid color" width="120">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=solid&carrier=bait) | [solid.js](bait/solid.js) | [Settings](#customize) | [Create widget](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=solid&carrier=bait) |
| Bait | Background image | [<img src="screenshots/bait_image.png" alt="Bait · background image" width="120">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=image&carrier=bait) | [image.js](bait/image.js) | [Settings](#customize) | [Create widget](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/?design=image&carrier=bait) |

## Install on iPhone

Not sure how to edit the code? Use the **[widget generator](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/)**: choose your carrier, design, and theme, adjust colors and chart style, then press **Generar código** and **Copiar código**. You can also download the complete `.js` file.

1. Install [Scriptable](https://scriptable.app) on your iPhone.
2. Create a script, paste the generated code or the entire JS file you chose above, and give it a name.
3. Run it with ▶ and save your account details: Telcel needs your 10-digit number
   and Mi Telcel password; Bait only needs your 10-digit number.
4. Add a **small Scriptable widget** to your home screen. Edit the widget, select
   your script, and set **When Interacting** to **Run Script**.

Your account details are stored in **iOS Keychain**. Both designs share one account
per carrier. To change it, run the script and choose **Cambiar datos**.
Manual runs show **Ver widget**, **Cambiar datos**, **Obtener nueva versión**,
and **Cancelar**; automatic
home-screen updates show no menu.

Telcel preserves each reading’s carrier unit: a remaining balance of `1,000 MB`
is displayed as `1,000 MB`, while a GB balance stays in GB. Percentages use a
common unit (1000 MB = 1 GB), so `5 MB` is treated as `0.005 GB` for the chart
and still displayed as `5 MB`. Total, used, and remaining readings each use their
own unit. Bait balances are displayed in GB.

To update an installed widget, replace its entire script with the latest code
from the generator or JS file. Saved account details and older GB readings
remain usable; a fresh carrier reading supplies the current MB/GB unit.

## Refresh behavior

Usage is saved in a local JSON file for **30 minutes**. A failed lookup keeps the
previous reading and pauses requests for **15 minutes**. If the carrier responds
with a rate limit, the widget follows its retry time when provided.

| Example | Result |
| --- | --- |
| First run at 10:00 | Calls the carrier and saves the reading. |
| Run again at 10:05 | Uses saved data; no carrier call. |
| Run at 10:31 | Calls the carrier again because the cache expired. |
| Request fails at 10:31 | Shows saved data with a warning; allows another attempt after 10:46. |

Retries happen on the next execution after the wait. **iOS controls refresh timing**,
so a call exactly every 30 minutes is not guaranteed. Simultaneous runs can still
make duplicate requests.

**Última ejecución** shows when the script ran, even when it used cached data or
failed. If there is no saved reading and the request fails, it shows an error.
Image backgrounds are cached separately for 24 hours.

## Widget updates

All four scripts share a release version embedded in their code. On execution,
they check the public [version file](version.json) at most once every **24 hours**,
using a shared local cache separate from your account and usage data. Checks send
no account information. iOS decides when the widget runs, so notices may appear
later than 24 hours after a release.

When a newer version exists, the widget shows **Nueva versión disponible**.
Tap the widget to open the generator with your carrier, design, and current
appearance settings restored, or
run the script in Scriptable and choose **Obtener nueva versión**. If the usage
lookup also failed, the notice reads **Error · Nueva versión**. Without an update,
tapping keeps its usual behavior.

Generate and copy the new code, then replace the entire existing Scriptable
script. Your Keychain account and compatible cached readings remain available.
The link carries background, primary/secondary text, and accent colors, chart
style, plan-name visibility, and (for image designs) the image URL and overlay
opacity. Appearance values are encoded in the URL fragment (`#…`); account
details are never included. You can adjust the restored settings before generating.
Older scripts without this feature need one manual update to start checking.

A failed version check stays silent, keeps the last known update status, and
retries on the next execution after **one hour**. It does not change carrier
refresh or retry times. Update checks use a separate 3-second request timeout.
Sample mode skips version checks; use `sampleState: "update"` or the generator's
**Nueva versión disponible** example state to preview the notice.

## Publishing a widget release

1. Choose a higher `major.minor.patch` version, starting from `1.0.0`; prerelease
   suffixes are not supported. Documentation-only changes need no version bump.
2. Update `widgets/version.json` and `WIDGET_VERSION` in all four standalone
   scripts to that same version. Keep the manifest's URL stable.
3. Run `node --test widgets/tests/*.test.cjs` from the repository root. The suite
   checks that the manifest and all four scripts agree.
4. Publish the scripts, manifest, and generator together in the same GitHub Pages
   deployment. Confirm `/widgets/version.json` and generator script downloads
   contain the new version before announcing the release.

The generator fetches fresh script text on every code-generation action. There
is no automatic script replacement, push notification, or Python server dependency.

## Debug

Set `debug: true` in `SETTINGS`, then run the script and check Scriptable's console.
Logs show request stages, HTTP status, timing, cache use, and retry waits. They omit
account details, keys, tokens, URLs, and response bodies. Set it back to `false`
when finished.

## Customize

Use the [generator](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/) for a visual setup, or edit the marked `SETTINGS` block near the top of your JS file:

| Setting | What to change |
| --- | --- |
| `backgroundHex` | Background and fallback color: six hex digits without `#`, such as `123456`. |
| `textPrimaryHex` | Balance and plan-name color. |
| `textSecondaryHex` | Details and chart-track color; the track uses 25% opacity. |
| `accentHex` | Chart fill and carrier-label color. |
| `chartStyle` | `bar`: progress bar; `arc`: centered semicircle above the balance; `none`: centered balance without a chart. |
| `showPlanName` | `true` shows the plan; `false` keeps only the carrier in the header. |
| `backgroundImageUrl` | Image design only: replace with your image URL. Use `""` for a solid background. |
| `backgroundOverlayOpacity` | Image design only: `0` means no dark overlay; `1` means fully black. |

Choose **Oscuro**, **Claro**, or **Personalizado** in the generator. Themes apply a
starting palette; editing any color switches to Personalizado. Changing carriers
preserves custom colors. Themes keep the selected image and overlay opacity.
Generated scripts include the final color values.

The bar and arc show the percentage **used**; the large balance shows remaining
data. The arc is a centered 180° semicircle above the balance, not a full ring. The balance, bar, and percentage are centered in every layout. Error messages keep a separate
warning color independent of the accent.

The [preview and generator](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/) uses sample data for display and generates a complete script for live usage. Account setup happens in Scriptable; credentials stay in Keychain. The existing carrier JS files are the source of the generated code.

For local development, serve the repository with `python3 -m http.server 8080` from its root and open `http://localhost:8080/widgets/previews/`. Opening `index.html` directly supports the preview, but code generation needs HTTP or the hosted page.

To try sample data inside Scriptable, set `useSampleData: true`. Choose
`sampleState`: `success`, `stale`, `error`, `setup`, or `update`; Bait also supports
`throttled` for reduced-speed data. Set `useSampleData` back to `false` for live usage.

## Folder structure

```text
widgets/
├── telcel/       Standalone Telcel scripts: solid.js and image.js
├── bait/         Standalone Bait scripts: solid.js and image.js
├── version.json  Shared published widget release version
├── previews/     One HTML preview and code generator
├── screenshots/  Widget images for documentation
├── tests/        Mocked Scriptable tests and response fixtures
├── README.md     English guide
└── README.es.md  Spanish guide
```
