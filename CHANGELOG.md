# Changelog

## 0.4.0 - 2026-05-01

Fork of [tonze/pi-updater](https://github.com/tonze/pi-updater) extended to cover all installed pi extensions and to default to silent auto-update.

- Reads `~/.pi/agent/settings.json` to discover all `npm:`-installed extensions and includes them in update checks alongside the core `@mariozechner/pi-coding-agent`.
- Replaces per-package `npm view` calls with a single batched `npm outdated -g --json` for all configured packages.
- New default behavior: when updates are found, silently install them in one batched `npm install -g`, then auto-restart pi on the current session — no prompts.
- `PI_AUTO_UPDATE=0` (or `false`/`off`/`no`) restores the previous interactive-prompt behavior.
- `/update` always shows the interactive selector regardless of `PI_AUTO_UPDATE`, so users can manually inspect what's available.
- Live-check updates that arrive mid-session are deferred to the next launch unless the agent is idle, to avoid surprising restarts during active work.
- Cache schema upgraded to track multiple packages and per-package dismissals.

## 0.3.0 - 2026-03-23

- Auto-restart pi after a successful update. Asks to restart, then seamlessly relaunches on the current session.
- Falls back to manual restart message in non-interactive modes or if restart fails.
- Cross-platform: uses `shell: true` on Windows to handle `.cmd` shims.
- `/update --test` to simulate the full update flow without a real install.

## 0.2.9 - 2026-03-16

- Keep startup checks cache-first and non-blocking.
- Add a one-time background live check per run.
- Show update prompt in the same session when the background check finds a newer version.
- Respect `PI_SKIP_VERSION_CHECK` and `PI_OFFLINE` for automatic checks.
- Avoid duplicate automatic prompts for the same version in one run.
- `/update` now warns and exits early when `PI_OFFLINE` is set.
