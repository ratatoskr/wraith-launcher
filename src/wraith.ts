// Talks to `wraith serve` through the Rust side. Protocol is in wraith's src/cli/serve.zig.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Arch = "x86" | "x64";
export type LogLevel = "err" | "warn" | "info" | "debug";

export type Status =
  | { state: "starting" }
  | { state: "installing"; version: string }
  | { state: "ready"; version: string }
  /** Protocol mismatch. `dev` means a dev build of Wraith. */
  | { state: "mismatch"; version: string; needs: "wraith" | "launcher"; dev: boolean }
  | { state: "failed"; error: string }
  | { state: "exited" };

export type WraithEvent =
  | { event: "ready"; protocol: number; version: string }
  | { event: "attached"; id: number; pid: number }
  | { event: "log"; level: LogLevel; scope: string; message: string };

/** `code` is wraith's error, e.g. "NotOurs", or the launcher's, e.g. "WraithNotRunning". */
export class WraithError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WraithError";
  }
}

let nextId = 1;

async function request<T>(method: string, params: object, id = nextId++): Promise<T> {
  try {
    return await invoke<T>("wraith_request", { id, method, params });
  } catch (e) {
    throw new WraithError(String(e));
  }
}

export const status = () => invoke<Status>("wraith_status");

export type CliStatus = { dir: string; on_path: boolean };
export const cliStatus = () => invoke<CliStatus>("cli_status");
export const setCliOnPath = (on: boolean) => invoke<CliStatus>("set_cli_on_path", { on });

export const onStatus = (handler: (status: Status) => void): Promise<UnlistenFn> =>
  listen<Status>("wraith://status", (e) => handler(e.payload));

export const onEvent = (handler: (event: WraithEvent) => void): Promise<UnlistenFn> =>
  listen<WraithEvent>("wraith://event", (e) => handler(e.payload));

/** A `wraith://install/<id>` link, like the hub's Install button, with the mod's id. */
export const onInstallLink = (handler: (id: string) => void): Promise<UnlistenFn> =>
  listen<string>("launcher://install", (e) => handler(e.payload));

/** The game's art from what its store keeps on this PC, as a data URL. Only Steam keeps any. */
export const gameArt = (id: string) => invoke<string | null>("game_art", { id });

/** Game ids to the Wraith Hub's copies of their pictures, on dist.wraith.io. */
export const hubArt = () => invoke<Record<string, string>>("hub_art");

/** One that came before the UI was listening, like the link that started the launcher. */
export const takeInstallLink = () => invoke<string | null>("take_install_link");

/** `id` is stable, for code and CSS. `label` is for showing. */
export interface Named {
  id: string;
  label: string;
}

/** `file` is the file, process or driver that gave it away. */
export interface AntiCheat {
  product: Named;
  file: string;
}

/** Like Unity or Unreal, from the files beside the game's exe. Not a script engine. */
export interface GameEngine {
  game_engine: Named;
  /** e.g. "IL2CPP" or "Mono" for Unity, "MV" for RPG Maker. */
  variant: string | null;
  /** e.g. "2021.3.16", when the files say. */
  version: string | null;
  /** What gave it away. */
  file: string;
}

/** Running anywhere. Some watch every program, not just their game. */
export const antiCheatRunning = () => request<AntiCheat[]>("anticheat", {});

export interface RunningProcess {
  pid: number;
  name: string;
  /** Null for e.g. a protected process. */
  path: string | null;
  arch: Arch | null;
  windowed: boolean;
  /** False if it's protected, or elevated and Wraith isn't. */
  inspected: boolean;
  wraith: boolean;
  /** Strongest first. */
  hints: Named[];
  anticheat: AntiCheat[];
  game_engine: GameEngine | null;
  score: number;
}

/** Likeliest games first. `all` adds windowless ones. */
export const processes = (all = false) => request<RunningProcess[]>("processes", { all });

export interface Inspection {
  arch: Arch;
  /** Our proxy, e.g. "version.dll". */
  installed: string | null;
  /** Proxy names someone else already uses. */
  taken: string[];
  anticheat: AntiCheat[];
  game_engine: GameEngine | null;
  game: Game;
}

export const inspect = (exe: string) => request<Inspection>("inspect", { exe });

export interface Game {
  /** e.g. "steam-1245620", "local-<exe>-<folder hash>" or a known game like "ffxiv". */
  id: string;
  store: Named;
  known: Named | null;
  name: string | null;
  /** For "local" it's the exe's folder. */
  dir: string;
  launch: Launch;
  store_exe: string | null;
  /** Unix seconds. Only Steam has it, and only in `games`. */
  last_played?: number | null;
}

/** Worked out by wraith's `launch.zig`. */
export interface Launch {
  /** "none" waits for the player to start it. */
  start: "store" | "exe" | "none";
  link: string | null;
  /** The game itself, or its launcher. */
  exe: string | null;
  /** Where Wraith goes. Null if we don't know which exe is the game. */
  game_exe: string | null;
  /** `exe` is the game, so Wraith goes in as it starts. */
  starts_game: boolean;
}

const samePath = (a: string, b: string) => a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();

/** Like wraith's `Launch.withPick`. */
export function withPick(launch: Launch, pick: string | undefined): Launch {
  if (!pick) return launch;
  if (launch.starts_game) return { ...launch, exe: pick, game_exe: pick };
  if (launch.start === "exe" && launch.exe && launch.game_exe && samePath(launch.exe, pick)) return launch;
  return { ...launch, game_exe: pick, starts_game: false };
}

export const identify = (exe: string) => request<Game>("identify", { exe });

export type InstalledGame = Game & {
  added: boolean;
  anticheat: AntiCheat[];
  game_engine: GameEngine | null;
};

/** For a game no store knows about. Already listed is fine. */
export const addGame = (exe: string) => request<Game>("game_add", { exe });

export const removeGame = (id: string) => request<{ removed: boolean }>("game_remove", { id });

export const games = () => request<InstalledGame[]>("games", {});

/** `as` is e.g. "winmm", default is version.dll. */
export const install = (exe: string, as?: string) =>
  request<{ arch: Arch; proxy: string }>("install", { exe, as });

export const uninstall = (exe: string) => request<{ removed: boolean }>("uninstall", { exe });

export const inject = (target: string | number) =>
  request<{ pid: number; arch: Arch; reloaded: boolean }>("inject", { target: String(target) });

export const launch = (exe: string, args: string[] = []) =>
  request<{ pid: number }>("launch", { exe, args });

/** Matches `exe`'s name or anything started from `dir`. `onAttached` fires per copy since games can restart. */
export const watch = (target: { exe: string } | { dir: string }, options: WaitOptions = {}) =>
  waiting("watch", target, options);

/** `exe` is the player's pick (see `withPick`). With "proxy" the pid is null. */
export const play = (id: string, options: WaitOptions & { exe?: string; how?: How } = {}) =>
  waiting("play", { id, exe: options.exe, how: options.how }, options);

export type How = "inject" | "proxy";

export interface Exe {
  path: string;
  size: number;
  store: boolean;
}

/** `exe` first, then biggest first. */
export const executables = (dir: string, exe: string | null) => request<Exe[]>("executables", { dir, exe });

/** A plugin or project from the Wraith Hub. */
export interface Mod {
  id: string;
  kind: "plugin" | "project";
  title: string;
  summary: string;
  author: string;
  any_game: boolean;
  /** IDs of the user's games. */
  games: string[];
  /** Recommended, for every game or one of the user's. */
  featured: boolean;
  /** Why, if it's recommended for every game. */
  why: string | null;
  /** Newest version this Wraith can run. */
  latest: string | null;
  /** Set if this Wraith is too old for every version. Empty when it's for a newer Wraith's API without saying which. */
  needs_wraith: string | null;
  /** Its newest isn't made for this Wraith's API, so it won't load till its author updates it. */
  outdated?: boolean;
  installed: string | null;
  /** The installed copy was pulled from the hub. Wraith won't load it, and updating takes it out. */
  revoked: boolean;
  /** Other mods use it and it comes with them, like an engine's helpers. Only listed once it's installed. */
  library?: boolean;
  /** A game engine's official plugin. Wraith keeps it installed and up to date, so it can't be removed. */
  essential?: boolean;
  /** Installed, and there's a newer version or it was pulled. Wraith works it out, the way it compares versions. */
  has_update: boolean;
}

export interface ModCatalog {
  generated: string;
  mods_dir: string;
  mods: Mod[];
}

export const mods = () => request<ModCatalog>("mods", {});

export const installMod = (id: string, version?: string) => request<{ version: string }>("mod_install", { id, version });

export const removeMod = (id: string) => request<object>("mod_remove", { id });

/** A null version means it was taken out, since the hub pulled it. */
export const updateMods = () => request<{ updated: { id: string; version: string | null }[] }>("mod_update", {});

/** What `keepEssentials` added (`was` is null) or updated. */
export interface Kept {
  id: string;
  title: string;
  was: string | null;
  version: string;
}

/** Installs or updates the official plugin of each of the player's games' engines. */
export const keepEssentials = () => request<{ kept: Kept[] }>("mod_essentials", {});

export const hasUpdate = (p: Mod) => p.has_update;

export type WaitOptions = { signal?: AbortSignal; onAttached?: (pid: number) => void };

async function waiting(method: string, params: object, options: WaitOptions): Promise<{ pid: number | null }> {
  const id = nextId++;
  const { signal, onAttached } = options;
  const unlisten = onAttached
    ? await onEvent((e) => {
        if (e.event === "attached" && e.id === id) onAttached(e.pid);
      })
    : undefined;
  const cancel = () => void request("cancel", { id }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await request<{ pid: number | null }>(method, params, id);
  } finally {
    signal?.removeEventListener("abort", cancel);
    unlisten?.();
  }
}
