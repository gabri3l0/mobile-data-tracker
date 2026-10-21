> [!NOTE]
> Para ver la versión en español, [haz clic aquí](README.es.md).

# Mobile Data Tracker

Check your Telcel or Bait mobile data usage from your home screen. Choose a
solid-color or image-background widget, copy one script into Scriptable, and
connect directly to your carrier.

## Get started

Open the **[widget guide](widgets/README.md)** to choose your script and install
it on your iPhone. It also covers customization, refresh behavior, and debugging.
No server or computer is needed.

## Preview

Choose Telcel or Bait in either preview to try colors, backgrounds, and sample states.

| Carrier | Solid color | Background image | Get code |
| --- | :---: | :---: | --- |
| Telcel | [<img src="widgets/screenshots/telcel_solid.png" alt="Telcel · solid color" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/solid.html?carrier=telcel) | [<img src="widgets/screenshots/telcel_image.png" alt="Telcel · background image" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/image.html?carrier=telcel) | [Telcel widgets](widgets/telcel/) |
| Bait | [<img src="widgets/screenshots/bait_solid.png" alt="Bait · solid color" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/solid.html?carrier=bait) | [<img src="widgets/screenshots/bait_image.png" alt="Bait · background image" width="180">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/image.html?carrier=bait) | [Bait widgets](widgets/bait/) |

## Widget features

- Remaining data and a usage progress bar.
- Plan name, expiration date, and days remaining.
- Account details stored in iOS Keychain.
- Customizable solid colors and background images.
- Saved readings available when updates fail.
- One timestamp showing when the script last ran.

## Optional central server

The Python CLI and API provide usage readings for both carriers, with API keys
and limits per person. Family-account tracking, daily consumption, history, and
trends are future goals.

See the **[server guide](server/README.md)** for setup, CLI commands, and endpoints.

## License

[MIT](LICENSE): use, modify, and redistribute the code, including commercially,
while keeping the copyright and license notice. The software comes without warranty.
Third-party images and assets retain their respective licenses.

## Disclaimer

This project is unofficial and is not affiliated with, endorsed by, or sponsored by the carrier.
Use only accounts you own or are authorized to access, and comply with applicable laws and carrier terms.
Personal account credentials, session tokens, and proprietary carrier software are not distributed with this project.
