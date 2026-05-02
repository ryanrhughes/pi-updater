import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { VERSION, BorderedLoader } from "@mariozechner/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const CORE_PACKAGE = "@mariozechner/pi-coding-agent";
const SETTINGS_FILE = join(homedir(), ".pi", "agent", "settings.json");
const CACHE_FILE = join(homedir(), ".pi", "agent", "update-cache.json");

const ENV_SKIP_VERSION_CHECK = "PI_SKIP_VERSION_CHECK";
const ENV_OFFLINE = "PI_OFFLINE";
const ENV_AUTO_UPDATE = "PI_AUTO_UPDATE";

interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
}

interface VersionCache {
  outdated: OutdatedPackage[];
  /** package name -> dismissed version */
  dismissed: Record<string, string>;
  checkedAt?: string;
}

function readCache(): VersionCache | undefined {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (Array.isArray(raw.outdated)) {
      return {
        outdated: raw.outdated as OutdatedPackage[],
        dismissed: (raw.dismissed as Record<string, string>) || {},
        checkedAt: raw.checkedAt as string | undefined,
      };
    }
    // Migrate old single-package cache (latestVersion / dismissedVersion).
    const dismissed: Record<string, string> = {};
    if (typeof raw.dismissedVersion === "string") {
      dismissed[CORE_PACKAGE] = raw.dismissedVersion;
    }
    return {
      outdated: [],
      dismissed,
      checkedAt: raw.checkedAt as string | undefined,
    };
  } catch {
    return undefined;
  }
}

function writeCache(cache: VersionCache) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    // Preserve legacy fields so older pi-updater versions sharing this cache
    // file can still read it without crashing on parseVersion(undefined).
    const core = cache.outdated.find((p) => p.name === CORE_PACKAGE);
    const legacy: { latestVersion: string; dismissedVersion?: string } = {
      latestVersion: core?.latest ?? VERSION,
    };
    if (cache.dismissed[CORE_PACKAGE]) {
      legacy.dismissedVersion = cache.dismissed[CORE_PACKAGE];
    }
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({ ...legacy, ...cache }) + "\n",
    );
  } catch {}
}

function isEnvSet(name: string): boolean {
  return Boolean(process.env[name]);
}

function shouldSkipAutoChecks(): boolean {
  return isEnvSet(ENV_SKIP_VERSION_CHECK) || isEnvSet(ENV_OFFLINE);
}

function isOffline(): boolean {
  return isEnvSet(ENV_OFFLINE);
}

function autoUpdateEnabled(): boolean {
  const v = process.env[ENV_AUTO_UPDATE];
  if (v === undefined) return true;
  return !["0", "false", "off", "no", ""].includes(v.toLowerCase());
}

function readConfiguredPackages(): string[] {
  const set = new Set<string>([CORE_PACKAGE]);
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as {
      packages?: string[];
    };
    for (const p of s.packages || []) {
      const m = String(p).match(/^npm:(.+)$/);
      if (m) set.add(m[1]);
    }
  } catch {}
  return Array.from(set);
}

async function fetchOutdated(
  pi: ExtensionAPI,
  pkgs: string[],
): Promise<OutdatedPackage[] | undefined> {
  try {
    // npm outdated exits 1 when packages are outdated, 0 when none. Both are fine.
    const r = await pi.exec("npm", ["outdated", "-g", "--json", ...pkgs], {
      timeout: 15_000,
    });
    const out = (r.stdout || "").trim();
    if (!out) return [];
    const obj = JSON.parse(out) as Record<
      string,
      { current?: string; latest?: string }
    >;
    const result: OutdatedPackage[] = [];
    for (const [name, v] of Object.entries(obj)) {
      if (v.latest && v.current && v.latest !== v.current) {
        result.push({ name, current: v.current, latest: v.latest });
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

function saveOutdatedToCache(outdated: OutdatedPackage[]) {
  const prev = readCache();
  writeCache({
    outdated,
    dismissed: prev?.dismissed || {},
    checkedAt: new Date().toISOString(),
  });
}

function dismissPackage(name: string, version: string) {
  const prev = readCache();
  writeCache({
    outdated: prev?.outdated || [],
    dismissed: { ...(prev?.dismissed || {}), [name]: version },
    checkedAt: prev?.checkedAt,
  });
}

function getActionablePackages(outdated: OutdatedPackage[]): OutdatedPackage[] {
  const cache = readCache();
  const dismissed = cache?.dismissed || {};
  return outdated.filter((p) => dismissed[p.name] !== p.latest);
}

function buildInstallArgs(pkgs: OutdatedPackage[]): string[] {
  return ["install", "-g", ...pkgs.map((p) => `${p.name}@${p.latest}`)];
}

function summarize(pkgs: OutdatedPackage[]): string {
  return pkgs.map((p) => `${p.name} ${p.current} → ${p.latest}`).join(", ");
}

export default function (pi: ExtensionAPI) {
  let runActive = false;
  let handledOnce = false;
  let liveCheckStarted = false;

  async function findPiBinary(): Promise<string> {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = await pi.exec(cmd, ["pi"]);
    if (result.code === 0 && result.stdout?.trim()) {
      return result.stdout.trim().split(/\r?\n/)[0];
    }
    return "pi";
  }

  function canAutoRestart(ctx: ExtensionContext): boolean {
    return ctx.hasUI && !!process.stdin.isTTY && !!process.stdout.isTTY;
  }

  async function restartPi(ctx: ExtensionContext): Promise<boolean> {
    const piBinary = await findPiBinary();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const restartArgs = sessionFile ? ["--session", sessionFile] : ["-c"];

    return ctx.ui.custom<boolean>((tui, _theme, _kb, done) => {
      tui.stop();
      const result = spawnSync(piBinary, restartArgs, {
        cwd: ctx.cwd,
        env: process.env,
        stdio: "inherit",
        shell: process.platform === "win32",
        windowsHide: false,
      });
      tui.start();
      tui.requestRender(true);
      done(!result.error && (result.status === null || result.status === 0));
      return { render: () => [], invalidate: () => {} };
    });
  }

  async function runInstall(
    ctx: ExtensionContext,
    pkgs: OutdatedPackage[],
    title: string,
  ): Promise<boolean> {
    const args = buildInstallArgs(pkgs);
    return ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(tui, theme, title);
      loader.onAbort = () => done(false);

      pi.exec("npm", args, { timeout: 180_000 })
        .then((result) => {
          if (result.code !== 0) {
            ctx.ui.notify(
              `Update failed (exit ${result.code}): ${result.stderr || result.stdout}`,
              "error",
            );
            done(false);
          } else {
            done(true);
          }
        })
        .catch(() => done(false));

      return loader;
    });
  }

  async function performInstallAndRestart(
    ctx: ExtensionContext,
    pkgs: OutdatedPackage[],
    silent: boolean,
  ) {
    if (silent) ctx.ui.notify(`Updating: ${summarize(pkgs)}`, "info");

    const ok = await runInstall(
      ctx,
      pkgs,
      `Updating ${pkgs.length} package${pkgs.length === 1 ? "" : "s"}...`,
    );
    if (!ok) return;

    saveOutdatedToCache([]);

    if (!canAutoRestart(ctx)) {
      ctx.ui.notify(
        `Updated ${pkgs.length} package(s). Please restart pi.\nTip: run \`pi -c\` to continue this session.`,
        "info",
      );
      return;
    }

    if (silent) {
      ctx.ui.notify("Restarting pi...", "info");
    } else {
      const restart = await ctx.ui.confirm(
        `Updated ${pkgs.length} package(s)!`,
        "Restart now?",
      );
      if (!restart) return;
    }

    const restarted = await restartPi(ctx);
    if (restarted) {
      ctx.shutdown();
      return;
    }
    ctx.ui.notify(
      `Updated. Auto-restart failed. Please restart pi manually.\nTip: run \`pi -c\` to continue this session.`,
      "error",
    );
  }

  async function showInteractivePrompt(
    ctx: ExtensionContext,
    pkgs: OutdatedPackage[],
  ) {
    if (!ctx.hasUI) return;
    const updateLabel = `Update all (${pkgs.length}): ${summarize(pkgs)}`;
    const choice = await ctx.ui.select("Updates available", [
      updateLabel,
      "Skip",
      "Skip these versions",
    ]);
    if (!choice || choice === "Skip") return;
    if (choice === "Skip these versions") {
      for (const p of pkgs) dismissPackage(p.name, p.latest);
      return;
    }
    await performInstallAndRestart(ctx, pkgs, false);
  }

  async function maybeHandleOutdated(
    ctx: ExtensionContext,
    outdated: OutdatedPackage[],
    source: "cache" | "live",
  ) {
    if (!ctx.hasUI) return;
    if (runActive || handledOnce) return;

    const actionable = getActionablePackages(outdated);
    if (actionable.length === 0) return;

    runActive = true;
    handledOnce = true;
    try {
      if (autoUpdateEnabled()) {
        // Only silent-restart from live check if user is idle.
        if (source === "live" && !ctx.isIdle()) return;
        await performInstallAndRestart(ctx, actionable, true);
      } else {
        await showInteractivePrompt(ctx, actionable);
      }
    } finally {
      runActive = false;
    }
  }

  function runAutoChecks(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    if (shouldSkipAutoChecks()) return;

    const cached = readCache()?.outdated || [];
    if (cached.length > 0) void maybeHandleOutdated(ctx, cached, "cache");

    if (liveCheckStarted) return;
    liveCheckStarted = true;

    const pkgs = readConfiguredPackages();
    void fetchOutdated(pi, pkgs)
      .then((outdated) => {
        if (!outdated) return;
        saveOutdatedToCache(outdated);
        void maybeHandleOutdated(ctx, outdated, "live");
      })
      .catch(() => {});
  }

  pi.on("session_start", async (_event, ctx) => {
    runAutoChecks(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    runAutoChecks(ctx);
  });

  pi.registerCommand("update", {
    description: "Check for pi and extension updates",
    handler: async (rawArgs, ctx) => {
      const args = (rawArgs || "").trim();

      if (args === "--test") {
        await runTestFlow(ctx);
        return;
      }

      if (isOffline()) {
        ctx.ui.notify(
          "PI_OFFLINE is set. Disable it to check for updates.",
          "warning",
        );
        return;
      }

      const pkgs = readConfiguredPackages();
      const outdated = await ctx.ui.custom<OutdatedPackage[] | null>(
        (tui, theme, _kb, done) => {
          const loader = new BorderedLoader(
            tui,
            theme,
            "Checking for updates...",
          );
          loader.onAbort = () => done(null);
          fetchOutdated(pi, pkgs)
            .then((v) => done(v ?? null))
            .catch(() => done(null));
          return loader;
        },
      );

      if (outdated === null) {
        ctx.ui.notify("Could not reach npm registry.", "error");
        return;
      }

      saveOutdatedToCache(outdated);

      if (outdated.length === 0) {
        ctx.ui.notify(`All ${pkgs.length} pi packages are up to date.`, "info");
        return;
      }

      handledOnce = true;
      await showInteractivePrompt(ctx, outdated);
    },
  });

  async function runTestFlow(ctx: ExtensionContext) {
    const fakePkgs: OutdatedPackage[] = [
      { name: CORE_PACKAGE, current: VERSION, latest: "99.0.0" },
      { name: "pi-fake-extension", current: "0.1.0", latest: "0.2.0" },
    ];
    const choice = await ctx.ui.select("Updates available (test)", [
      `Update all (${fakePkgs.length}): ${summarize(fakePkgs)}`,
      "Skip",
      "Skip these versions",
    ]);
    if (!choice || choice === "Skip" || choice === "Skip these versions") return;

    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(tui, theme, "Updating 2 packages...");
      loader.onAbort = () => done();
      setTimeout(() => done(), 1500);
      return loader;
    });

    if (!canAutoRestart(ctx)) {
      ctx.ui.notify("Updated! Please restart pi.", "info");
      return;
    }

    const restart = await ctx.ui.confirm("Updated!", "Restart now?");
    if (!restart) return;
    const ok = await restartPi(ctx);
    if (ok) ctx.shutdown();
    else ctx.ui.notify("Test restart failed.", "error");
  }
}
