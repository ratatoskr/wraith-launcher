import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as wraith from "./wraith";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { UpdateBanner } from "./Update";
import "./App.css";

const refreshMs = 3000;
const maxLogLines = 200;

function MismatchBanner(props: { status: Extract<wraith.Status, { state: "mismatch" }> }) {
  const { version, needs, dev } = props.status;
  let text: string;
  if (needs === "launcher") {
    text = `Wraith ${version} is newer than this app, so they can't talk. Update the app and restart it.`;
  } else if (dev) {
    text = `The dev build of Wraith (${version}) is older than this app, so they can't talk. Rebuild Wraith (zig build) and restart the app.`;
  } else {
    text = `Wraith ${version} is older than this app, so they can't talk. The app installs the newest Wraith when it starts: restart it once a newer Wraith is out.`;
  }
  return <div className="mismatch-banner">{text}</div>;
}

function describe(status: wraith.Status): string {
  switch (status.state) {
    case "starting":
      return "Starting Wraith...";
    case "installing":
      return `Installing Wraith ${status.version}...`;
    case "ready":
      return `Wraith ${status.version}`;
    case "mismatch":
      return `Wraith ${status.version} doesn't match this app`;
    case "failed":
      return `Wraith couldn't start: ${status.error}`;
    case "exited":
      return "Wraith stopped";
  }
}

type LogLine = Extract<wraith.WraithEvent, { event: "log" }> & { key: number };

/** By row key. `cancel` stops one still waiting for a game to start. */
type ActionState = { state: "busy"; label: string; cancel?: () => void } | { state: "failed"; error: string };

type Pending = { key: string; name: string; found: wraith.AntiCheat[]; run: () => void };

type Tab = "games" | "running" | "mods";

const processKey = (p: wraith.RunningProcess) => `pid:${p.pid}`;
const gameKey = (g: wraith.Game) => `game:${g.id}`;

/** Case-insensitive like Windows. */
function isWithin(dir: string, path: string): boolean {
  const d = dir.replace(/[\\/]+$/, "").toLowerCase().replace(/\//g, "\\");
  const p = path.toLowerCase().replace(/\//g, "\\");
  return p.startsWith(d + "\\");
}

/** Picks the likeliest game started from its folder. */
function runningAs(processes: wraith.RunningProcess[], g: wraith.Game): wraith.RunningProcess | undefined {
  return processes.filter((p) => p.path && isWithin(g.dir, p.path)).sort((a, b) => b.score - a.score)[0];
}

/** `played` is unix seconds. */
type GameChoice = { exe?: string; how: wraith.How; played?: number };

/** Saved between runs. */
const choicesKey = "wraith.games";

function loadChoices(): Record<string, GameChoice> {
  try {
    return JSON.parse(localStorage.getItem(choicesKey) ?? "{}");
  } catch {
    return {};
  }
}

function gameName(g: wraith.Game): string {
  return g.name ?? g.known?.label ?? g.id;
}

function relativeTo(dir: string, path: string): string {
  return isWithin(dir, path) ? path.slice(dir.replace(/[\\/]+$/, "").length + 1) : path;
}

/** Relative to the game's folder, or just the file name if elsewhere. */
function startLabel(dir: string, launch: wraith.Launch): string | null {
  if (launch.start !== "exe" || !launch.exe || launch.starts_game) return null;
  return isWithin(dir, launch.exe) ? relativeTo(dir, launch.exe) : launch.exe.split(/[\\/]/).pop()!;
}

function formatSize(bytes: number): string {
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatAgo(seconds: number): string {
  const days = Math.round((seconds * 1000 - Date.now()) / 86_400_000);
  if (days > -1) return "today";
  if (days > -14) return relativeTime.format(days, "day");
  if (days > -60) return relativeTime.format(Math.round(days / 7), "week");
  if (days > -730) return relativeTime.format(Math.round(days / 30), "month");
  return relativeTime.format(Math.round(days / 365), "year");
}

function errorText(e: unknown): string {
  return e instanceof wraith.WraithError ? e.code : String(e);
}

function App() {
  const [status, setStatus] = useState<wraith.Status>({ state: "starting" });
  const [tab, setTab] = useState<Tab>("games");
  const [version, setVersion] = useState<string | null>(null);
  const [processes, setProcesses] = useState<wraith.RunningProcess[]>([]);
  const [antiCheatRunning, setAntiCheatRunning] = useState<wraith.AntiCheat[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [games, setGames] = useState<wraith.InstalledGame[] | null>(null);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLElement>(null);
  const ready = status.state === "ready";

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    // Listen first so we don't miss a change in between
    const unlisten = wraith.onStatus(setStatus);
    wraith.status().then(setStatus);
    return () => void unlisten.then((f) => f());
  }, []);

  useEffect(() => {
    let key = 0;
    const unlisten = wraith.onEvent((e) => {
      if (e.event !== "log") return;
      const line = { ...e, key: key++ };
      setLog((lines) => [...lines.slice(-(maxLogLines - 1)), line]);
    });
    return () => void unlisten.then((f) => f());
  }, []);

  const refreshProcesses = useCallback(async () => {
    try {
      const [list, running] = await Promise.all([wraith.processes(showAll), wraith.antiCheatRunning()]);
      setProcesses(list);
      setAntiCheatRunning(running);
      setListError(null);
    } catch (e) {
      setListError(String(e));
    }
  }, [showAll]);

  useEffect(() => {
    if (!ready) return;
    refreshProcesses();
    const timer = setInterval(refreshProcesses, refreshMs);
    return () => clearInterval(timer);
  }, [ready, refreshProcesses]);

  // Only changes on install. Read on demand
  const refreshGames = useCallback(async () => {
    try {
      setGames(await wraith.games());
      setGamesError(null);
    } catch (e) {
      setGamesError(String(e));
    }
  }, []);

  useEffect(() => {
    if (ready) refreshGames();
  }, [ready, refreshGames]);

  const [catalog, setCatalog] = useState<wraith.ModCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const refreshCatalog = useCallback(async () => {
    try {
      setCatalog(await wraith.mods());
      setCatalogError(null);
    } catch (e) {
      setCatalogError(errorText(e));
    }
  }, []);
  useEffect(() => {
    if (ready) refreshCatalog();
  }, [ready, refreshCatalog]);
  const [modsOf, setModsOf] = useState<string | null>(null);
  const modsFor = (g: wraith.Game) => catalog?.mods.filter((p) => p.games.includes(g.id)) ?? [];

  async function modAction(name: string, change: "install" | "remove") {
    await perform(`mod:${name}`, change === "install" ? "Installing..." : "Removing...", () =>
      change === "install" ? wraith.installMod(name) : wraith.removeMod(name),
    );
    refreshCatalog();
  }

  async function updateAllMods() {
    await perform("mods", "Updating...", wraith.updateMods);
    refreshCatalog();
  }

  const [choices, setChoices] = useState<Record<string, GameChoice>>(loadChoices);
  const choiceOf = (g: wraith.Game): GameChoice => choices[g.id] ?? { how: "inject" };
  const planOf = (g: wraith.Game, pick = choiceOf(g).exe): wraith.Launch => wraith.withPick(g.launch, pick);
  /** Store's time or ours, whichever is later. */
  const lastPlayed = (g: wraith.Game): number | null =>
    Math.max(g.last_played ?? 0, choiceOf(g).played ?? 0) || null;
  function choose(id: string, change: Partial<GameChoice>) {
    setChoices((all) => {
      const next: Record<string, GameChoice> = { ...all, [id]: { ...(all[id] ?? { how: "inject" }), ...change } };
      localStorage.setItem(choicesKey, JSON.stringify(next));
      return next;
    });
  }

  const [picking, setPicking] = useState<{ id: string; exes: wraith.Exe[]; thenPlay: boolean } | null>(null);

  // Proxy and anti-cheat next to each game's exe
  const [inspections, setInspections] = useState<Record<string, { exe: string; found: wraith.Inspection }>>({});
  const inspectGame = useCallback(async (id: string, exe: string) => {
    try {
      const found = await wraith.inspect(exe);
      setInspections((s) => ({ ...s, [id]: { exe, found } }));
    } catch {
      // Probably gone
    }
  }, []);
  useEffect(() => {
    for (const g of games ?? []) {
      const exe = planOf(g).game_exe;
      if (exe && inspections[g.id]?.exe !== exe) inspectGame(g.id, exe);
    }
    // Only ones we haven't checked yet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, choices, inspectGame]);
  const inspectionOf = (g: wraith.Game) => {
    const i = inspections[g.id];
    return i && i.exe === planOf(g).game_exe ? i.found : undefined;
  };

  async function perform(key: string, label: string, action: () => Promise<unknown>, cancel?: () => void) {
    setPending(null);
    setActions((s) => ({ ...s, [key]: { state: "busy", label, cancel } }));
    try {
      await action();
      setActions(({ [key]: _, ...rest }) => rest);
    } catch (e) {
      setActions((s) => ({ ...s, [key]: { state: "failed", error: errorText(e) } }));
    }
    refreshProcesses();
  }

  /** Asks the user to OK the risk first if there's anti-cheat. */
  function guarded(key: string, name: string, found: wraith.AntiCheat[], run: () => void) {
    if (found.length !== 0 || antiCheatRunning.length !== 0) setPending({ key, name, found, run });
    else run();
  }

  function requestInject(p: wraith.RunningProcess, key = processKey(p), addToGames = true) {
    guarded(key, p.name, p.anticheat, () =>
      perform(key, "Injecting...", async () => {
        await wraith.inject(p.pid);
        // Injected from the running list, so it's a game. List it if no store does
        if (addToGames && p.path) {
          await wraith.addGame(p.path).catch(() => null);
          refreshGames();
        }
      }),
    );
  }

  // Pick a folder, then which exe if there's more than one
  const [adding, setAdding] = useState<{ dir: string; exes: wraith.Exe[] } | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  async function addFolder() {
    setAddError(null);
    const dir = await openDialog({ directory: true, title: "The game's folder" });
    if (typeof dir !== "string") return;
    try {
      const exes = await wraith.executables(dir, null);
      if (exes.length === 0) setAddError(`No exes in ${dir}`);
      else if (exes.length === 1) await addExe(exes[0].path);
      else setAdding({ dir, exes });
    } catch (e) {
      setAddError(errorText(e));
    }
  }
  async function addExe(exe: string) {
    setAdding(null);
    try {
      await wraith.addGame(exe);
      refreshGames();
    } catch (e) {
      setAddError(errorText(e));
    }
  }
  function removeGame(g: wraith.InstalledGame) {
    perform(gameKey(g), "Removing...", async () => {
      await wraith.removeGame(g.id);
      refreshGames();
    });
  }

  function requestPlay(g: wraith.InstalledGame) {
    if (planOf(g).game_exe) startPlay(g, choiceOf(g).exe);
    else pickExe(g, true);
  }

  /** No exes means play goes into whatever starts from its folder. */
  async function pickExe(g: wraith.InstalledGame, thenPlay: boolean) {
    const key = gameKey(g);
    let exes: wraith.Exe[];
    try {
      exes = await wraith.executables(g.dir, g.store_exe);
    } catch (e) {
      setActions((s) => ({ ...s, [key]: { state: "failed", error: errorText(e) } }));
      return;
    }
    if (exes.length > 1) return setPicking({ id: g.id, exes, thenPlay });
    const exe = exes[0]?.path;
    if (exe) choose(g.id, { exe });
    if (thenPlay) startPlay(g, exe);
  }

  function picked(g: wraith.InstalledGame, exe: string) {
    const thenPlay = picking?.thenPlay ?? false;
    setPicking(null);
    choose(g.id, { exe });
    if (thenPlay) startPlay(g, exe);
  }

  /** `pick` is passed in since `choose` hasn't landed yet right after picking. */
  async function startPlay(g: wraith.InstalledGame, pick: string | undefined) {
    const key = gameKey(g);
    const how = choiceOf(g).how;
    const plan = planOf(g, pick);
    // Not running yet, so check anti-cheat in its folder and next to the game
    let found = g.anticheat;
    if (plan.game_exe) found = mergeAntiCheat(found, (await wraith.inspect(plan.game_exe).catch(() => null))?.anticheat ?? []);
    guarded(key, gameName(g), found, () => {
      choose(g.id, { played: Math.floor(Date.now() / 1000) });
      const stop = new AbortController();
      const label =
        how === "proxy"
          ? "Starting..."
          : plan.start === "none"
            ? `Start it from ${g.store.label}...`
            : startLabel(g.dir, plan)
              ? "Waiting for the game (log in)..."
              : "Waiting for it...";
      perform(
        key,
        label,
        async () => {
          try {
            await wraith.play(g.id, { exe: pick, how, signal: stop.signal, onAttached: refreshProcesses });
          } finally {
            if (plan.game_exe) inspectGame(g.id, plan.game_exe);
          }
        },
        how === "inject" ? () => stop.abort() : undefined,
      );
    });
  }

  /** Switching back to inject removes the proxy, or Wraith would load twice. */
  function setHow(g: wraith.Game, how: wraith.How) {
    choose(g.id, { how });
    const exe = planOf(g).game_exe;
    if (how === "inject" && exe && inspectionOf(g)?.installed) {
      perform(gameKey(g), "Removing its proxy...", async () => {
        try {
          await wraith.uninstall(exe);
        } finally {
          await inspectGame(g.id, exe);
        }
      });
    }
  }

  const confirmation = (key: string, colSpan: number) =>
    pending?.key === key && (
      <ConfirmRow pending={pending} running={antiCheatRunning} colSpan={colSpan} onCancel={() => setPending(null)} />
    );

  return (
    <main className="app">
      <header className="header">
        <h1>Wraith</h1>
        <span className={`status status-${status.state}`}>{describe(status)}</span>
      </header>
      <UpdateBanner />
      {status.state === "mismatch" && <MismatchBanner status={status} />}

      <nav className="tabs">
        <button className={tab === "games" ? "active" : undefined} onClick={() => setTab("games")}>
          Games{games ? ` (${games.length})` : ""}
        </button>
        <button className={tab === "running" ? "active" : undefined} onClick={() => setTab("running")}>
          Running
        </button>
        <button className={tab === "mods" ? "active" : undefined} onClick={() => setTab("mods")}>
          Mods
          {catalog && catalog.mods.some(wraith.hasUpdate) && <span className="badge">updates</span>}
        </button>
      </nav>

      {antiCheatRunning.length !== 0 && (
        <div className="anticheat-banner">
          Anti-cheat is running: {antiCheatList(antiCheatRunning)}. It may watch every program, so injecting into any
          game could be detected while it runs.
        </div>
      )}

      {tab === "games" ? (
        <GamesTab
          games={games}
          error={gamesError}
          ready={ready}
          onRefresh={refreshGames}
          lastPlayed={lastPlayed}
          confirmation={confirmation}
          row={(g) => (
            <GameRow
              game={g}
              lastPlayed={lastPlayed(g)}
              process={runningAs(processes, g)}
              action={actions[gameKey(g)]}
              choice={choiceOf(g)}
              plan={planOf(g)}
              proxy={inspectionOf(g)?.installed ?? null}
              exeAntiCheat={inspectionOf(g)?.anticheat ?? []}
              onInject={(p) => requestInject(p, gameKey(g), false)}
              onPlay={() => requestPlay(g)}
              onPickExe={() => pickExe(g, false)}
              onHow={(how) => setHow(g, how)}
              mods={modsFor(g)}
              modsOpen={modsOf === g.id}
              onMods={() => setModsOf(modsOf === g.id ? null : g.id)}
              onRemove={g.added ? () => removeGame(g) : undefined}
            />
          )}
          picker={(g) =>
            picking?.id === g.id && (
              <ExePicker dir={g.dir} store={g.store} exes={picking.exes} onPick={(exe) => picked(g, exe)} onCancel={() => setPicking(null)} />
            )
          }
          onAdd={addFolder}
          adding={
            adding && <ExePicker dir={adding.dir} store={null} exes={adding.exes} onPick={addExe} onCancel={() => setAdding(null)} />
          }
          addError={addError}
          panel={(g) =>
            modsOf === g.id && (
              <tr className="mods-panel">
                <td colSpan={gameColumns}>
                  {runningAs(processes, g)?.wraith && (
                    <p className="note">
                      Wraith is in it: changes here reach it once the mod's reloaded (in game, from the Plugins
                      window).
                    </p>
                  )}
                  <ModList mods={modsFor(g)} actions={actions} onChange={modAction} />
                </td>
              </tr>
            )
          }
        />
      ) : tab === "mods" ? (
        <ModsTab
          catalog={catalog}
          error={catalogError}
          games={games ?? []}
          ready={ready}
          actions={actions}
          onRefresh={refreshCatalog}
          onChange={modAction}
          onUpdateAll={updateAllMods}
        />
      ) : (
        <>
          <div className="toolbar">
            <label>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} />
              Include programs without a window
            </label>
            <button onClick={refreshProcesses} disabled={!ready}>
              Refresh
            </button>
          </div>
          {listError && <p className="error">Couldn't list processes: {listError}</p>}
          <div className="list">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>PID</th>
                  <th>Arch</th>
                  <th>Looks like</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {processes.map((p) => (
                  <Fragment key={p.pid}>
                    <ProcessRow process={p} action={actions[processKey(p)]} onInject={() => requestInject(p)} />
                    {confirmation(processKey(p), 5)}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section className="log" ref={logRef}>
        {log.map((line) => (
          <div key={line.key} className={`log-${line.level}`}>
            {line.message}
          </div>
        ))}
      </section>
      <footer className="footer">
        <span>
          Made with <span className="heart">♥</span> by Asgard
        </span>
        {/* main is always 0.0.0, only releases get a real version */}
        {version && <span>{version === "0.0.0" ? "Dev build" : `v${version}`}</span>}
      </footer>
    </main>
  );
}

const gameColumns = 4;

type GameSort = { by: "name" | "store" | "played"; descending: boolean };

function GamesTab(props: {
  games: wraith.InstalledGame[] | null;
  error: string | null;
  ready: boolean;
  onRefresh: () => void;
  lastPlayed: (g: wraith.InstalledGame) => number | null;
  confirmation: (key: string, colSpan: number) => React.ReactNode;
  row: (g: wraith.InstalledGame) => React.ReactNode;
  picker: (g: wraith.InstalledGame) => React.ReactNode;
  panel: (g: wraith.InstalledGame) => React.ReactNode;
  onAdd: () => void;
  adding: React.ReactNode;
  addError: string | null;
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<GameSort>({ by: "played", descending: true });
  const { lastPlayed } = props;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const nameOf = (g: wraith.InstalledGame) => gameName(g);
    const all = props.games ?? [];
    const byName = (a: wraith.InstalledGame, b: wraith.InstalledGame) => nameOf(a).localeCompare(nameOf(b));
    const compare = {
      name: byName,
      store: (a: wraith.InstalledGame, b: wraith.InstalledGame) => a.store.label.localeCompare(b.store.label),
      played: (a: wraith.InstalledGame, b: wraith.InstalledGame) => (lastPlayed(a) ?? 0) - (lastPlayed(b) ?? 0),
    }[sort.by];
    const direction = sort.descending ? -1 : 1;
    return (f ? all.filter((g) => nameOf(g).toLowerCase().includes(f)) : all)
      .slice()
      .sort((a, b) => direction * compare(a, b) || byName(a, b));
  }, [props.games, filter, sort, lastPlayed]);

  /** Click again to flip. Times start newest first, names A to Z. */
  const header = (by: GameSort["by"], label: string) => (
    <th aria-sort={sort.by === by ? (sort.descending ? "descending" : "ascending") : undefined}>
      <button
        className="sort"
        onClick={() => setSort(sort.by === by ? { by, descending: !sort.descending } : { by, descending: by === "played" })}
      >
        {label}
        {sort.by === by && (sort.descending ? " ▼" : " ▲")}
      </button>
    </th>
  );

  return (
    <>
      <div className="toolbar">
        <input
          className="filter"
          type="search"
          placeholder="Find a game"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        <button onClick={props.onRefresh} disabled={!props.ready}>
          Refresh
        </button>
        <button onClick={props.onAdd} disabled={!props.ready} title="Add a game no store knows about, from its folder">
          Add a game...
        </button>
      </div>
      {props.error && <p className="error">Couldn't list games: {props.error}</p>}
      {props.addError && <p className="error">Couldn't add it: {props.addError}</p>}
      {props.adding && (
        <div className="list">
          <table>
            <tbody>{props.adding}</tbody>
          </table>
        </div>
      )}
      <div className="list">
        <table>
          <thead>
            <tr>
              {header("name", "Name")}
              {header("store", "Store")}
              {header("played", "Last played")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {props.games === null && (
              <tr>
                <td colSpan={gameColumns} className="empty">
                  {props.ready ? "Looking for games..." : "Waiting for Wraith..."}
                </td>
              </tr>
            )}
            {props.games?.length === 0 && (
              <tr>
                <td colSpan={gameColumns} className="empty">
                  No games found from Steam, GOG, Epic or Xbox.
                </td>
              </tr>
            )}
            {shown.map((g) => (
              <Fragment key={g.id}>
                {props.row(g)}
                {props.picker(g)}
                {props.panel(g)}
                {props.confirmation(gameKey(g), gameColumns)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function playTitle(g: wraith.InstalledGame, plan: wraith.Launch, how: wraith.How): string {
  const store = g.store.label;
  if (how === "proxy") return "Puts Wraith's proxy DLL beside the game (if it isn't there), then starts it: it loads Wraith itself";
  const first = startLabel(g.dir, plan);
  switch (plan.start) {
    case "store":
      return `Starts it through ${store}, and Wraith goes in as the game starts`;
    case "exe":
      return first
        ? `Starts ${first}, and Wraith goes in as the game starts after it`
        : "Starts the game with Wraith in it from the start";
    case "none":
      return `Start it from ${store}: Wraith goes in as the game starts`;
  }
}

function GameRow(props: {
  game: wraith.InstalledGame;
  /** Unix seconds. */
  lastPlayed: number | null;
  process?: wraith.RunningProcess;
  action?: ActionState;
  choice: GameChoice;
  plan: wraith.Launch;
  proxy: string | null;
  exeAntiCheat: wraith.AntiCheat[];
  onInject: (p: wraith.RunningProcess) => void;
  onPlay: () => void;
  onPickExe: () => void;
  onHow: (how: wraith.How) => void;
  mods: wraith.Mod[];
  modsOpen: boolean;
  onMods: () => void;
  onRemove?: () => void;
}) {
  const { game: g, process: p, action, choice, plan, proxy } = props;
  const busy = action?.state === "busy" ? action : null;
  const waits = choice.how === "inject" && plan.start === "none";
  const first = startLabel(g.dir, plan);

  let main: React.ReactNode;
  if (busy) {
    main = (
      <>
        <span className="running">{busy.label}</span>
        {busy.cancel && <button onClick={busy.cancel}>Cancel</button>}
      </>
    );
  } else if (p) {
    main = <button onClick={() => props.onInject(p)}>{p.wraith ? "Reload" : "Inject"}</button>;
  } else {
    main = (
      <button onClick={props.onPlay} title={playTitle(g, plan, choice.how)}>
        {waits ? "Wait for it" : "Play with Wraith"}
      </button>
    );
  }

  return (
    <tr>
      <td title={g.dir}>
        {gameName(g)}
        <div className="sub">
          {first && <>starts {first}, Wraith goes into </>}
          {plan.game_exe ? relativeTo(g.dir, plan.game_exe) : "Which exe is the game: asked when you play"}{" "}
          <button className="link" onClick={props.onPickExe} disabled={!!busy}>
            {plan.game_exe ? "change" : "choose now"}
          </button>
          {props.onRemove && (
            <>
              {" · "}
              <button className="link" onClick={props.onRemove} disabled={!!busy} title="You added this one. Take it off the list (nothing's deleted)">
                remove
              </button>
            </>
          )}
          {props.mods.length > 0 && (
            <>
              {" · "}
              <button className="link" onClick={props.onMods}>
                {props.modsOpen ? "hide mods" : `${props.mods.length} mod${props.mods.length > 1 ? "s" : ""}`}
              </button>
              {props.mods.some(wraith.hasUpdate) && <span className="badge">update</span>}
            </>
          )}
        </div>
      </td>
      <td>
        <span className={`hint hint-${g.store.id}`}>{g.store.label}</span>
        <AntiCheatHints found={mergeAntiCheat(g.anticheat, props.exeAntiCheat)} />
      </td>
      <td className="sub" title={props.lastPlayed ? new Date(props.lastPlayed * 1000).toLocaleString() : undefined}>
        {props.lastPlayed ? formatAgo(props.lastPlayed) : "—"}
      </td>
      <td className="actions">
        {p?.wraith && <span className="attached">Wraith attached</span>}
        {p && !p.wraith && !busy && <span className="running">Running</span>}
        {proxy && (
          <span className="attached" title={`Wraith's ${proxy} is beside it: it loads Wraith however it's started`}>
            Proxy in
          </span>
        )}
        {action?.state === "failed" && <span className="error">{action.error}</span>}
        <select
          value={choice.how}
          disabled={!!busy}
          onChange={(e) => props.onHow(e.currentTarget.value as wraith.How)}
          title="How Wraith goes into the game"
        >
          <option value="inject">Inject</option>
          <option value="proxy">Proxy DLL</option>
        </select>
        {main}
      </td>
    </tr>
  );
}

/** Stores often start a launcher instead of the game. */
function ExePicker(props: {
  dir: string;
  store: wraith.Named | null;
  exes: wraith.Exe[];
  onPick: (exe: string) => void;
  onCancel: () => void;
}) {
  return (
    <tr className="picker">
      <td colSpan={gameColumns}>
        <p>Which is the game? Wraith goes into the one you pick (its launcher, if it has one, is left alone).</p>
        <ul>
          {props.exes.map((e) => (
            <li key={e.path}>
              <button onClick={() => props.onPick(e.path)}>{relativeTo(props.dir, e.path)}</button>
              <span className="sub">
                {formatSize(e.size)}
                {e.store && props.store && ` · what ${props.store.label} starts`}
              </span>
            </li>
          ))}
        </ul>
        <button onClick={props.onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

function ModList(props: {
  mods: wraith.Mod[];
  actions: Record<string, ActionState>;
  onChange: (name: string, change: "install" | "remove") => void;
  forWhat?: (p: wraith.Mod) => React.ReactNode;
}) {
  return (
    <table className="mod-list">
      <tbody>
        {props.mods.map((p) => (
          <tr key={p.id}>
            <td title={p.why ?? undefined}>
              {p.title || p.id}
              {p.kind === "project" && <span className="tag">Project</span>}
              {p.featured && <span className="tag">Recommended</span>}
              <div className="sub">{p.summary}</div>
              <div className="sub">
                {p.id} · by {p.author}
              </div>
            </td>
            {props.forWhat && <td className="sub">{props.forWhat(p)}</td>}
            <td className="actions">
              <ModActions mod={p} action={props.actions[`mod:${p.id}`]} onChange={props.onChange} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModActions(props: {
  mod: wraith.Mod;
  action?: ActionState;
  onChange: (name: string, change: "install" | "remove") => void;
}) {
  const { mod: p, action } = props;
  if (action?.state === "busy") return <span className="running">{action.label}</span>;
  return (
    <>
      {action?.state === "failed" && <span className="error">{action.error}</span>}
      {p.revoked && (
        <span className="error" title="Wraith won't load it. Update or remove it">
          pulled from the hub
        </span>
      )}
      {p.installed ? (
        <span className="attached" title="Installed">
          {p.installed}
        </span>
      ) : p.latest ? (
        <span className="sub">{p.latest}</span>
      ) : (
        <span className="note" title={`Every version needs Wraith ${p.needs_wraith} or newer`}>
          needs Wraith {p.needs_wraith}
        </span>
      )}
      {!p.installed && p.latest && <button onClick={() => props.onChange(p.id, "install")}>Install</button>}
      {wraith.hasUpdate(p) && <button onClick={() => props.onChange(p.id, "install")}>{p.revoked ? "Replace with" : "Update to"} {p.latest}</button>}
      {p.installed && (
        <button className="secondary" onClick={() => props.onChange(p.id, "remove")}>
          Remove
        </button>
      )}
    </>
  );
}

/** Installed first, then recommended, then ones for the user's games, then the rest. */
function ModsTab(props: {
  catalog: wraith.ModCatalog | null;
  error: string | null;
  games: wraith.Game[];
  ready: boolean;
  actions: Record<string, ActionState>;
  onRefresh: () => void;
  onChange: (name: string, change: "install" | "remove") => void;
  onUpdateAll: () => void;
}) {
  const [filter, setFilter] = useState("");
  const names = useMemo(() => new Map(props.games.map((g) => [g.id, gameName(g)])), [props.games]);
  const rank = (p: wraith.Mod) => (p.installed ? 0 : p.featured ? 1 : p.games.length > 0 ? 2 : p.any_game ? 3 : 4);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (props.catalog?.mods ?? [])
      .filter((p) => !f || `${p.title} ${p.id} ${p.summary} ${p.kind}`.toLowerCase().includes(f))
      .sort((a, b) => rank(a) - rank(b) || (a.title || a.id).localeCompare(b.title || b.id));
  }, [props.catalog, filter]);
  const updates = props.catalog?.mods.filter(wraith.hasUpdate).length ?? 0;
  const updating = props.actions["mods"];

  const forWhat = (p: wraith.Mod) =>
    p.any_game ? "Any game" : p.games.length > 0 ? p.games.map((id) => names.get(id) ?? id).join(", ") : "None of your games";

  return (
    <>
      <div className="toolbar">
        <input
          className="filter"
          type="search"
          placeholder="Find a mod"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        {updating?.state === "busy" ? (
          <span className="running">{updating.label}</span>
        ) : (
          updates > 0 && <button onClick={props.onUpdateAll}>Update all ({updates})</button>
        )}
        {updating?.state === "failed" && <span className="error">{updating.error}</span>}
        <button onClick={props.onRefresh} disabled={!props.ready}>
          Refresh
        </button>
      </div>
      {props.error && <p className="error">Couldn't get mods from the hub: {props.error}</p>}
      <div className="list">
        {props.catalog === null ? (
          <p className="empty">{props.ready ? "Getting mods from the hub..." : "Waiting for Wraith..."}</p>
        ) : shown.length === 0 ? (
          <p className="empty">No mods{filter ? " match" : " published yet"}.</p>
        ) : (
          <ModList mods={shown} actions={props.actions} onChange={props.onChange} forWhat={forWhat} />
        )}
      </div>
      {props.catalog && <p className="sub">Installed in {props.catalog.mods_dir}</p>}
      <CliToggle />
    </>
  );
}

/** For `wraith dev add` and friends. */
function CliToggle() {
  const [cli, setCli] = useState<wraith.CliStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    wraith.cliStatus().then(setCli, (e) => setError(errorText(e)));
  }, []);
  if (!cli) return error ? <p className="sub error">{error}</p> : null;
  const toggle = (on: boolean) => {
    setError(null);
    wraith.setCliOnPath(on).then(setCli, (e) => setError(errorText(e)));
  };
  return (
    <p className="sub">
      <label title={`It's in ${cli.dir}. New terminals pick up the change`}>
        <input type="checkbox" checked={cli.on_path} onChange={(e) => toggle(e.currentTarget.checked)} />
        <code>wraith</code> command on PATH (for building plugins: <code>wraith dev add</code>)
      </label>
      {error && <span className="error"> {error}</span>}
    </p>
  );
}

function ProcessRow(props: { process: wraith.RunningProcess; action?: ActionState; onInject: () => void }) {
  const { process: p, action } = props;
  const busy = action?.state === "busy";
  const label = action?.state === "busy" ? action.label : null;
  return (
    <tr className={p.score <= 20 ? "unlikely" : undefined}>
      <td title={p.path ?? undefined}>{p.name}</td>
      <td>{p.pid}</td>
      <td>{p.arch ?? "?"}</td>
      <td>
        <AntiCheatHints found={p.anticheat} />
        {p.hints.map((h) => (
          <span key={h.id} className={`hint hint-${h.id}`}>
            {h.label}
          </span>
        ))}
      </td>
      <td className="actions">
        {p.wraith && <span className="attached">Wraith attached</span>}
        {!p.inspected && p.windowed && (
          <span className="note" title="It's probably running as administrator: run Wraith as administrator to inject">
            Elevated?
          </span>
        )}
        {action?.state === "failed" && <span className="error">{action.error}</span>}
        <button onClick={props.onInject} disabled={busy}>
          {label ?? (p.wraith ? "Reload" : "Inject")}
        </button>
      </td>
    </tr>
  );
}

function antiCheatList(found: wraith.AntiCheat[]): string {
  return found.map((ac) => ac.product.label).join(", ");
}

/** One per product. */
function mergeAntiCheat(a: wraith.AntiCheat[], b: wraith.AntiCheat[]): wraith.AntiCheat[] {
  return [...a, ...b.filter((ac) => !a.some((x) => x.product.id === ac.product.id))];
}

function AntiCheatHints(props: { found: wraith.AntiCheat[] }) {
  return props.found.map((ac) => (
    <span key={ac.product.id} className="hint hint-anticheat" title={`Found ${ac.file}`}>
      ⚠ {ac.product.label}
    </span>
  ));
}

function ConfirmRow(props: { pending: Pending; running: wraith.AntiCheat[]; colSpan: number; onCancel: () => void }) {
  const { pending, running } = props;
  return (
    <tr className="confirm">
      <td colSpan={props.colSpan}>
        <p>
          {pending.found.length !== 0 ? (
            <>
              <strong>{pending.name}</strong> is protected by {antiCheatList(pending.found)}.
            </>
          ) : (
            <>Anti-cheat is running on this computer: {antiCheatList(running)}.</>
          )}{" "}
          Injecting Wraith may be detected, and can get the account banned. Only go on if you know this game allows it
          (single-player or offline, say).
        </p>
        <div className="confirm-actions">
          <button className="danger" onClick={pending.run}>
            I understand the risk, go on
          </button>
          <button onClick={props.onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

export default App;
