# Wraith Launcher

[![CI](https://img.shields.io/github/actions/workflow/status/ratatoskr/wraith-launcher/main_ci.yml?branch=main&label=CI)](https://github.com/ratatoskr/wraith-launcher/actions/workflows/main_ci.yml)
[![License](https://img.shields.io/github/license/ratatoskr/wraith-launcher)](https://github.com/ratatoskr/wraith-launcher/blob/main/LICENSE)
[![Version](https://img.shields.io/github/v/tag/ratatoskr/wraith-launcher?label=version)](https://github.com/ratatoskr/wraith-launcher/tags)

The Wraith desktop app. It installs Wraith, finds your games, manages your mods, and starts games with Wraith.

Pre-release. Expect breaking changes.

Using Wraith in online games can get you banned. Use it offline or in single-player.

## Want to download?

Get the Wraith app from [wraith.io](https://wraith.io). It installs Wraith, finds your games, and installs mods from the [Hub](https://hub.wraith.io). New to it? [Start here](https://docs.wraith.io/play/).

## Working on it

`npm run tauri dev` runs the whole app. For just the UI, `npm run dev` and open `http://localhost:1420/?mock` in a browser. It fakes Wraith with made-up games and mods, from `src/dev/mock.ts`. Add `&install=<id>` to try a hub Install link.

## License

MIT, see [LICENSE](LICENSE). Third-party notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).