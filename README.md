# pi-updater

Auto-updater for pi **and** its installed extensions. By default, silently updates and restarts on startup when newer versions are available — no prompts, no manual steps.

- repo: https://github.com/ryanrhughes/pi-updater
- forked from: https://github.com/tonze/pi-updater

> **Note:** Automatic installation currently supports npm-based pi installs only.

## What it does

**On startup:**
1. Reads `~/.pi/agent/settings.json` to find every `npm:`-installed extension, plus the core `@mariozechner/pi-coding-agent`.
2. Runs a single batched `npm outdated -g --json` against that set.
3. If anything is outdated:
   - **Auto-update mode (default):** runs one batched `npm install -g pkg@latest …`, then auto-restarts pi on the current session.
   - **Prompt mode** (`PI_AUTO_UPDATE=0`): shows the legacy interactive selector — `Update all` / `Skip` / `Skip these versions`.

**`/update`:** manually check for updates. Always shows the interactive selector regardless of `PI_AUTO_UPDATE`, so you can inspect what's available on demand.

## How version checks work

Cache-first to keep startup snappy:

1. On startup, cached outdated data is acted on instantly (auto-install or prompt).
2. One background live check refreshes the cache.
3. If the live check finds new updates and the agent is idle, they're applied in the same session. Otherwise they're saved to cache and applied on next launch.
4. Auto checks are skipped when `PI_SKIP_VERSION_CHECK` or `PI_OFFLINE` is set.

## Install

```bash
pi install npm:pi-updater
```

Or from git:

```bash
pi install git:github.com/ryanrhughes/pi-updater
```

## Usage

- Auto-update happens automatically at startup. No action needed.
- Use `/update` inside pi to manually inspect/install updates with a confirmation prompt.

## Environment flags

| Variable | Effect |
|---|---|
| `PI_AUTO_UPDATE=0` | Disable silent auto-update; show the interactive prompt instead. Also accepts `false`, `off`, `no`. |
| `PI_SKIP_VERSION_CHECK=1` | Disable automatic checks entirely. Manual `/update` still works. |
| `PI_OFFLINE=1` | Disable all network checks (and `/update`). |

## Updating this package

If `pi-updater` itself has an update, it gets picked up by the same batched check and updated alongside everything else.

## License

MIT
