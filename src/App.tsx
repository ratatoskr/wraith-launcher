import { useCallback, useEffect, useMemo, useState } from "react";
import * as wraith from "./wraith";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Blocker, LauncherUpdate, Progress } from "./Update";
import {
  type ActionState,
  antiCheatList,
  ConfirmPanel,
  errorText,
  ExePicker,
  type GameChoice,
  gameKey,
  gameName,
  mergeAntiCheat,
  type Pending,
  processKey,
  runningAs,
  startLabel,
} from "./common";
import { GameRow, GamesView } from "./GamesView";
import { GameMods, ModsView } from "./ModsView";
import { type LogLine, MoreView } from "./MoreView";
import "./App.css";

const refreshMs = 3000;
const maxLogLines = 200;

type Tab = "games" | "mods" | "more";

/** Saved between runs. */
const choicesKey = "wraith.games";

function loadChoices(): Record<string, GameChoice> {
  try {
    return JSON.parse(localStorage.getItem(choicesKey) ?? "{}");
  } catch {
    return {};
  }
}

function MismatchBanner(props: { status: Extract<wraith.Status, { state: "mismatch" }> }) {
  const { version, needs, dev } = props.status;
  let text: string;
  if (needs === "launcher") {
    text = `Wraith ${version} is newer than this launcher, so they can't talk. Restart the launcher to update it.`;
  } else if (dev) {
    text = `The dev build of Wraith (${version}) is older than this launcher, so they can't talk. Rebuild it (zig build) and restart the launcher.`;
  } else {
    text = `Wraith ${version} is older than this launcher, so they can't talk. The launcher installs the newest Wraith when it starts, so restart it once a newer one is out.`;
  }
  return <div className="banner banner-bad">{text}</div>;
}

/** The dot in the corner, and what hovering it says. */
function statusOf(status: wraith.Status): { tone: "ok" | "busy" | "bad"; text: string } {
  switch (status.state) {
    case "starting":
      return { tone: "busy", text: "Starting" };
    case "installing":
      return { tone: "busy", text: `Updating to ${status.version}` };
    case "ready":
      return { tone: "ok", text: "Ready" };
    case "mismatch":
      return { tone: "bad", text: "Doesn't match this launcher" };
    case "failed":
      return { tone: "bad", text: `Couldn't start: ${status.error}` };
    case "exited":
      return { tone: "bad", text: "Stopped" };
  }
}

function frameworkVersion(status: wraith.Status): string {
  switch (status.state) {
    case "ready":
      return status.version;
    case "mismatch":
      return status.dev ? `${status.version} (dev)` : status.version;
    case "installing":
      return `updating to ${status.version}`;
    case "starting":
      return "...";
    case "failed":
    case "exited":
      return "not running";
  }
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
  const ready = status.state === "ready";

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

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
      setListError(errorText(e));
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
      setGamesError(errorText(e));
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

  // Asked for by a wraith://install link. Shown at the top of Mods for the player to install, never by itself
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => {
    const show = (id: string) => {
      setAsked(id);
      setTab("mods");
    };
    const unlisten = wraith.onInstallLink((id) => {
      show(id);
      void wraith.takeInstallLink();
    });
    wraith.takeInstallLink().then((id) => id && show(id));
    return () => void unlisten.then((f) => f());
  }, []);

  // Art from the stores' own caches, asked once per game. Null is none, so it's not asked again
  const [art, setArt] = useState<Record<string, string | null>>({});
  useEffect(() => {
    for (const g of games ?? []) {
      if (g.id in art || !g.id.startsWith("steam-")) continue;
      setArt((a) => ({ ...a, [g.id]: null }));
      wraith
        .gameArt(g.id)
        .then((url) => url && setArt((a) => ({ ...a, [g.id]: url })))
        .catch(() => {});
    }
    // Only ones not asked yet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games]);

  // Then the hub's copies, for the rest. Once a run, since they barely change
  const [hubArt, setHubArt] = useState<Record<string, string>>({});
  useEffect(() => {
    if (ready) wraith.hubArt().then(setHubArt, () => {});
  }, [ready]);

  const [modsOf, setModsOf] = useState<string | null>(null);
  const modsFor = (g: wraith.Game) => catalog?.mods.filter((p) => p.games.includes(g.id)) ?? [];
  const names = useMemo(() => new Map((games ?? []).map((g) => [g.id, gameName(g)])), [games]);

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
  const lastPlayed = useCallback(
    (g: wraith.Game): number | null => Math.max(g.last_played ?? 0, choices[g.id]?.played ?? 0) || null,
    [choices],
  );
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

  /** Asks the player to OK the risk first if there's anti-cheat. */
  function guarded(key: string, name: string, found: wraith.AntiCheat[], run: () => void) {
    if (found.length !== 0 || antiCheatRunning.length !== 0) setPending({ key, name, found, run });
    else run();
  }

  function requestInject(p: wraith.RunningProcess, key = processKey(p), addToGames = true) {
    guarded(key, p.name, p.anticheat, () =>
      perform(key, "Adding Wraith...", async () => {
        await wraith.inject(p.pid);
        // Added from what's running, so it's a game. List it if no store does
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
      if (exes.length === 0) setAddError(`There's no exe in ${dir}`);
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
              ? "Waiting for the game (log in if it asks)..."
              : "Waiting for it to start...";
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

  const confirmation = (key: string) =>
    pending?.key === key && <ConfirmPanel pending={pending} running={antiCheatRunning} onCancel={() => setPending(null)} />;

  const shown = statusOf(status);
  const modUpdates = catalog?.mods.filter(wraith.hasUpdate).length ?? 0;
  const runningGames = (games ?? []).filter((g) => runningAs(processes, g)?.wraith).length;

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.png" alt="" width="28" height="28" />
          <span>Wraith</span>
        </div>
        <nav className="tabs">
          <button className={tab === "games" ? "on" : undefined} onClick={() => setTab("games")}>
            Games
            {runningGames > 0 && <span className="dot ok" title="Wraith is in a game" />}
          </button>
          <button className={tab === "mods" ? "on" : undefined} onClick={() => setTab("mods")}>
            Mods
            {modUpdates > 0 && <span className="badge">{modUpdates}</span>}
          </button>
          <button className={tab === "more" ? "on" : undefined} onClick={() => setTab("more")}>
            More
          </button>
        </nav>
        <span className={`status status-${shown.tone}`} title={`Wraith ${frameworkVersion(status)}`}>
          <span className={`dot ${shown.tone}`} />
          {shown.text}
        </span>
      </header>
      <LauncherUpdate />
      {status.state === "installing" && (
        <Blocker title={`Updating Wraith to ${status.version}`}>
          <p>It's ready to play once it's in.</p>
          <Progress />
        </Blocker>
      )}
      {status.state === "mismatch" && <MismatchBanner status={status} />}
      {(status.state === "failed" || status.state === "exited") && (
        <div className="banner banner-bad">
          {status.state === "failed" ? `Wraith couldn't start: ${status.error}.` : "Wraith stopped."} Restart the launcher to try again. More has the log.
        </div>
      )}
      {antiCheatRunning.length !== 0 && (
        <div className="banner banner-warn">
          ⚠ Anti-cheat is running: {antiCheatList(antiCheatRunning)}. It may watch every program, so it could notice Wraith in any game while it runs.
        </div>
      )}

      {tab === "games" && (
        <GamesView
          games={games}
          error={gamesError}
          ready={ready}
          onRefresh={refreshGames}
          onAdd={addFolder}
          addError={addError}
          adding={adding && <ExePicker dir={adding.dir} store={null} exes={adding.exes} onPick={addExe} onCancel={() => setAdding(null)} />}
          lastPlayed={lastPlayed}
          row={(g) => (
            <GameRow
              key={g.id}
              game={g}
              lastPlayed={lastPlayed(g)}
              process={runningAs(processes, g)}
              action={actions[gameKey(g)]}
              choice={choiceOf(g)}
              plan={planOf(g)}
              proxy={inspectionOf(g)?.installed ?? null}
              exeAntiCheat={inspectionOf(g)?.anticheat ?? []}
              exeGameEngine={inspectionOf(g)?.game_engine ?? null}
              onInject={(p) => requestInject(p, gameKey(g), false)}
              onPlay={() => requestPlay(g)}
              onPickExe={() => pickExe(g, false)}
              onHow={(how) => setHow(g, how)}
              mods={modsFor(g)}
              modsOpen={modsOf === g.id}
              onMods={() => setModsOf(modsOf === g.id ? null : g.id)}
              onRemove={g.added ? () => removeGame(g) : undefined}
              art={art[g.id] ?? hubArt[g.id] ?? null}
              below={
                <>
                  {picking?.id === g.id && (
                    <ExePicker dir={g.dir} store={g.store} exes={picking.exes} onPick={(exe) => picked(g, exe)} onCancel={() => setPicking(null)} />
                  )}
                  {confirmation(gameKey(g))}
                  {modsOf === g.id && <GameMods mods={modsFor(g)} running={!!runningAs(processes, g)?.wraith} actions={actions} onChange={modAction} />}
                </>
              }
            />
          )}
        />
      )}
      {tab === "mods" && (
        <ModsView
          catalog={catalog}
          error={catalogError}
          games={games ?? []}
          gameName={(id) => names.get(id) ?? id}
          ready={ready}
          actions={actions}
          onRefresh={refreshCatalog}
          onChange={modAction}
          onUpdateAll={updateAllMods}
          asked={asked}
          onDismissAsked={() => setAsked(null)}
        />
      )}
      {tab === "more" && (
        <MoreView
          processes={processes}
          listError={listError}
          showAll={showAll}
          onShowAll={setShowAll}
          ready={ready}
          onRefresh={refreshProcesses}
          actions={actions}
          onInject={(p) => requestInject(p)}
          confirmation={(p) => confirmation(processKey(p))}
          log={log}
          launcherVersion={version}
          frameworkVersion={frameworkVersion(status)}
        />
      )}
    </main>
  );
}

export default App;
