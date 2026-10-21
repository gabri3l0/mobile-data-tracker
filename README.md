# Mobile Data Tracker

Track mobile data usage with two components:

- [Widgets](widgets/README.md): Scriptable widgets for iPhone showing remaining data,
  plan expiration, and the latest reading on your home screen.
  [Standalone Telcel](widgets/telcel/README.md) and [Bait](widgets/bait/README.md) widgets connect directly to their carriers.
- [Central server](server/README.md): Python API and CLI for current usage, with the
  longer-term purpose of tracking family accounts, daily consumption, history, and
  trends. Those account-management and analytics features are not implemented yet.

The central server supports Telcel and Bait.

## Preview

Choose Telcel or Bait in either preview to try colors, backgrounds, and sample states.

| Solid | Image 1 | Image 2 |
| :---: | :---: | :---: |
| [<img src="widgets/screenshots/dark.jpg" alt="Solid widget" width="240">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/solid.html) | [<img src="widgets/screenshots/image-retro.jpg" alt="Image 1 widget" width="240">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/image.html) | [<img src="widgets/screenshots/image-landscape.jpg" alt="Image 2 widget" width="240">](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/image.html) |
| [Open Solid preview](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/solid.html) | [Open Image 1 preview](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/image.html) | [Open Image 2 preview](https://gabri3l0.github.io/mobile-data-tracker/widgets/previews/image.html) |

## Features

- Remaining and used data, with a usage progress bar.
- Plan name, expiration date, and days remaining.
- Solid hex-color and customizable image-background widgets.
- One self-contained script per carrier and design, with Keychain setup.
- Cached readings available when updates fail.
- One timestamp showing the latest widget execution, including failed updates.
- Bearer-protected API with limits per person.
- CLI access and browser previews.

## Guides

- [Central server](server/README.md) — setup, CLI, API, authentication, and tests.
- [iPhone widgets](widgets/README.md) — designs, Scriptable setup, and refresh behavior.

Run Python commands from `server/` and keep local configuration in `server/.env`.

## License

[MIT](LICENSE): use, modify, and redistribute the code, including commercially,
while keeping the copyright and license notice. The software comes without warranty.
Third-party images and assets retain their respective licenses.

## Disclaimer

This project is unofficial and is not affiliated with, endorsed by, or sponsored by the carrier.
Use only accounts you own or are authorized to access, and comply with applicable laws and carrier terms.
Personal account credentials, session tokens, and proprietary carrier software are not distributed with this project.
