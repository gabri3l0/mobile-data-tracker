# Mobile Data Widgets

Check your remaining mobile data and plan expiration from your home screen.
Each widget connects directly to Telcel or Bait: copy one script, with no server
or computer needed. Android is not supported yet.

| Carrier | Design | Preview | Script | Customize |
| --- | --- | --- | --- | --- |
| Telcel | Solid color | &lt;image&gt; | [solid.js](telcel/solid.js) | [Settings](#customize) |
| Telcel | Background image | &lt;image&gt; | [image.js](telcel/image.js) | [Settings](#customize) |
| Bait | Solid color | &lt;image&gt; | [solid.js](bait/solid.js) | [Settings](#customize) |
| Bait | Background image | &lt;image&gt; | [image.js](bait/image.js) | [Settings](#customize) |

<!-- Replace the <image> placeholders with screenshots for each widget. -->

## Install on iPhone

1. Install [Scriptable](https://scriptable.app) on your iPhone.
2. Create a script, paste the entire JS file you chose above, and give it a name.
3. Run it with ▶ and save your account details: Telcel needs your 10-digit number
   and Mi Telcel password; Bait only needs your 10-digit number.
4. Add a **small Scriptable widget** to your home screen. Edit the widget, select
   your script, and set **When Interacting** to **Run Script**.

Your account details are stored in **iOS Keychain**. Both designs share one account
per carrier. To change it, run the script and choose **Cambiar datos**.
Manual runs show **Ver widget**, **Cambiar datos**, and **Cancelar**; automatic
home-screen updates show no menu.

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

## Debug

Set `debug: true` in `SETTINGS`, then run the script and check Scriptable's console.
Logs show request stages, HTTP status, timing, cache use, and retry waits. They omit
account details, keys, tokens, URLs, and response bodies. Set it back to `false`
when finished.

## Customize

Edit the marked `SETTINGS` block near the top of your chosen JS file:

| Setting | What to change |
| --- | --- |
| `backgroundHex` | Replace with a six-digit hex color without `#`, such as `123456`. |
| `backgroundImageUrl` | Image design only: replace with your image URL. Use `""` for a solid background. |
| `backgroundOverlayOpacity` | Image design only: `0` means no dark overlay; `1` means fully black. |

Open the [solid preview](previews/solid.html) or [image preview](previews/image.html)
in your browser to try colors, images, carriers, and states with sample data.
Copy the generated values into `SETTINGS`; previews do not edit your JS file.

To try sample data inside Scriptable, set `useSampleData: true`. Choose
`sampleState`: `success`, `stale`, `error`, or `setup`; Bait also supports
`throttled` for reduced-speed data. Set `useSampleData` back to `false` for live usage.
