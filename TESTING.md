# Testing locally

## Setup

Uninstall the npm version and install from the local checkout:

```bash
pi uninstall npm:pi-updater
pi install ~/Work/pi-updater
```

Or load it directly without touching installed packages:

```bash
pi -ne -e ~/Work/pi-updater/index.ts
```

## Test the simulated update flow

```
/update --test
```

Simulates a multi-package interactive prompt → install (fake 1.5s) → confirm restart → restart on same session. This always uses the interactive flow regardless of `PI_AUTO_UPDATE`.

## Test silent auto-update

Force a real outdated state:

```bash
# Downgrade the core pi to make it look outdated.
npm install -g @mariozechner/pi-coding-agent@0.61.1
# Reinstall pi-updater since the pi downgrade nukes it.
pi install ~/Work/pi-updater
pi
```

You should see a brief "Updating: …" notification, an install loader, then pi auto-restarts on the latest version.

## Test prompt-mode fallback

```bash
PI_AUTO_UPDATE=0 pi
```

When updates exist, you should see the interactive selector instead of a silent update.

## Screen recording

To hide skills/extensions on startup, set in `~/.pi/agent/settings.json`:

```json
{
  "quietStartup": true
}
```

## Restore npm version

```bash
pi uninstall ~/Work/pi-updater
pi install npm:pi-updater
```
