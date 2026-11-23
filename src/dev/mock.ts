// For working on the UI in a browser: `npm run dev`, then open it with `?mock`. Answers like the
// Rust side and `wraith serve` would, with made-up games and mods. Never in a real build.

import { mockIPC } from "@tauri-apps/api/mocks";
import type * as w from "../wraith";

const named = (id: string, label: string): w.Named => ({ id, label });
const now = Math.floor(Date.now() / 1000);

const launch = (exe: string): w.Launch => ({ start: "store", link: null, exe, game_exe: exe, starts_game: true });

const games: w.InstalledGame[] = [
  {
    id: "steam-1245620",
    store: named("steam", "Steam"),
    known: null,
    name: "Elden Ring",
    dir: "D:\\Steam\\steamapps\\common\\ELDEN RING\\Game",
    launch: { start: "store", link: "steam://rungameid/1245620", exe: "D:\\Steam\\steamapps\\common\\ELDEN RING\\Game\\start_protected_game.exe", game_exe: null, starts_game: false },
    store_exe: "start_protected_game.exe",
    last_played: now - 86400 * 2,
    added: false,
    anticheat: [{ product: named("eac", "Easy Anti-Cheat"), file: "EasyAntiCheat\\EasyAntiCheat_EOS_Setup.exe" }],
    game_engine: null,
  },
  {
    id: "steam-632360",
    store: named("steam", "Steam"),
    known: null,
    name: "Risk of Rain 2",
    dir: "D:\\Steam\\steamapps\\common\\Risk of Rain 2",
    launch: launch("D:\\Steam\\steamapps\\common\\Risk of Rain 2\\Risk of Rain 2.exe"),
    store_exe: "Risk of Rain 2.exe",
    last_played: now - 3600,
    added: false,
    anticheat: [],
    game_engine: { game_engine: named("unity", "Unity"), variant: "Mono", version: "2021.3.33", file: "UnityPlayer.dll" },
  },
  {
    id: "gog-1207658930",
    store: named("gog", "GOG"),
    known: null,
    name: "The Witcher 3: Wild Hunt",
    dir: "D:\\GOG\\The Witcher 3",
    launch: launch("D:\\GOG\\The Witcher 3\\bin\\x64\\witcher3.exe"),
    store_exe: null,
    last_played: null,
    added: false,
    anticheat: [],
    game_engine: null,
  },
  {
    id: "local-kai-1a2b",
    store: named("local", "Added by you"),
    known: named("kai", "Trails beyond the Horizon"),
    name: null,
    dir: "D:\\Games\\Kai",
    launch: { start: "exe", link: null, exe: "D:\\Games\\Kai\\kai.exe", game_exe: "D:\\Games\\Kai\\kai.exe", starts_game: true },
    store_exe: null,
    last_played: now - 86400 * 40,
    added: true,
    anticheat: [],
    game_engine: null,
  },
];

const processes: w.RunningProcess[] = [
  {
    pid: 4120,
    name: "Risk of Rain 2.exe",
    path: "D:\\Steam\\steamapps\\common\\Risk of Rain 2\\Risk of Rain 2.exe",
    arch: "x64",
    windowed: true,
    inspected: true,
    wraith: true,
    hints: [named("unity", "Unity")],
    anticheat: [],
    game_engine: games[1].game_engine,
    score: 90,
  },
  { pid: 9912, name: "firefox.exe", path: "C:\\Program Files\\Mozilla Firefox\\firefox.exe", arch: "x64", windowed: true, inspected: true, wraith: false, hints: [named("browser", "Browser")], anticheat: [], game_engine: null, score: 5 },
];

const mod = (m: Partial<w.Mod> & Pick<w.Mod, "id" | "title">): w.Mod => ({
  kind: "plugin",
  summary: "",
  author: "Asgard",
  any_game: false,
  games: [],
  featured: false,
  why: null,
  latest: "1.0.0",
  needs_wraith: null,
  installed: null,
  revoked: false,
  ...m,
});

let mods: w.Mod[] = [
  mod({ id: "camera", title: "Camera Tools", summary: "Fly the camera around, or orbit it round a point. Good for screenshots.", any_game: true, library: true, installed: "1.1.0", latest: "1.2.0" }),
  mod({ id: "posing", title: "Posing", summary: "Pose characters' bones, with a gizmo over the game.", any_game: true, library: true, latest: "0.4.0" }),
  mod({ id: "unity", title: "Unity", summary: "The free camera, posing and game speed in Unity games.", games: ["steam-632360"], featured: true }),
  mod({ id: "kai_tables", kind: "project", title: "Kai Tables", summary: "Addresses and tweaks for Trails beyond the Horizon.", author: "Kat", games: ["local-kai-1a2b"] }),
  mod({ id: "elden_fps", title: "Unlock FPS", summary: "Takes off the 60 FPS cap.", author: "Someone", games: ["steam-1245620"], latest: null, needs_wraith: "0.9.0" }),
  mod({ id: "elden_hud", title: "HUD Toggle", summary: "Hide the HUD with a key.", author: "Someone", games: ["steam-1245620"], latest: null, outdated: true, installed: "0.3.0" }),
  mod({ id: "ffxiv_glam", title: "Glamour Preview", summary: "Try on gear without owning it.", author: "Someone else" }),
];

const log: { level: w.LogLevel; scope: string; message: string }[] = [
  { level: "info", scope: "serve", message: "Wraith 0.3.0 ready" },
  { level: "warn", scope: "games", message: "Couldn't read the Epic manifest folder" },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "games":
      return games;
    case "processes":
      return processes;
    case "anticheat":
      return [];
    case "mods":
      return { generated: new Date().toISOString(), mods_dir: "C:\\Users\\you\\AppData\\Local\\Wraith\\mods", mods };
    case "inspect": {
      const g = games.find((x) => x.launch.game_exe === params.exe) ?? games[0];
      return { arch: "x64", installed: null, taken: [], anticheat: [], game_engine: g.game_engine, game: g };
    }
    case "executables":
      return [
        { path: `${params.dir}\\eldenring.exe`, size: 85_000_000, store: false },
        { path: `${params.dir}\\start_protected_game.exe`, size: 4_000_000, store: true },
      ];
    case "mod_install":
      await wait(800);
      mods = mods.map((m) => (m.id === params.id ? { ...m, installed: m.latest } : m));
      return { version: "1.0.0" };
    case "mod_remove":
      await wait(400);
      mods = mods.map((m) => (m.id === params.id ? { ...m, installed: null } : m));
      return {};
    case "mod_update":
      await wait(800);
      mods = mods.map((m) => (m.installed ? { ...m, installed: m.latest } : m));
      return { updated: [] };
    case "play":
      await wait(4000);
      return { pid: 1234 };
    case "inject":
      await wait(800);
      return { pid: params.target, arch: "x64", reloaded: false };
    default:
      return {};
  }
}

/** A 460x215 picture like Steam's headers, different per game. */
function fakeArt(id: string): string {
  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='460' height='215'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},60%,35%)'/><stop offset='1' stop-color='hsl(${(hue + 60) % 360},70%,15%)'/></linearGradient></defs><rect width='460' height='215' fill='url(%23g)'/><circle cx='360' cy='60' r='90' fill='white' fill-opacity='.12'/><text x='24' y='190' font-family='Segoe UI' font-size='34' font-weight='700' fill='white'>${id}</text></svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

export function installMock() {
  mockIPC(
    async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "wraith_status":
          return { state: "ready", version: "0.3.0" };
        case "wraith_request":
          return request(a.method as string, a.params as Record<string, unknown>);
        case "cli_status":
        case "set_cli_on_path":
          return { dir: "C:\\Users\\you\\AppData\\Local\\Wraith\\bin", on_path: a.on ?? true };
        case "game_art":
          // Stands in for Steam's cached header, for Steam games only like the real one
          return String(a.id).startsWith("steam-") ? fakeArt(String(a.id)) : null;
        case "hub_art":
          // What the hub has for a game Steam's cache can't cover
          return { "gog-1207658930": fakeArt("from the hub") };
        case "take_install_link":
          return new URLSearchParams(location.search).get("install");
        case "plugin:app|version":
          return "0.0.0";
        default:
          console.info("mock", cmd, a);
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  // Log lines come as events once something listens
  setTimeout(async () => {
    const { emit } = await import("@tauri-apps/api/event");
    for (const line of log) await emit("wraith://event", { event: "log", ...line });
  }, 500);
}
