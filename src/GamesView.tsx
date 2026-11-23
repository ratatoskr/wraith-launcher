// The player's games, from their stores and the ones they added, each ready to play with Wraith.

import { useMemo, useState } from "react";
import * as wraith from "./wraith";
import {
  AntiCheatHints,
  type ActionState,
  formatAgo,
  GameEngineHint,
  type GameChoice,
  gameName,
  mergeAntiCheat,
  relativeTo,
  startLabel,
  Tile,
} from "./common";

type Sort = "played" | "name" | "store";

export function GamesView(props: {
  games: wraith.InstalledGame[] | null;
  error: string | null;
  ready: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  addError: string | null;
  /** The exe picker for a folder being added. */
  adding: React.ReactNode;
  lastPlayed: (g: wraith.InstalledGame) => number | null;
  row: (g: wraith.InstalledGame) => React.ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("played");
  const { lastPlayed } = props;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = props.games ?? [];
    const byName = (a: wraith.InstalledGame, b: wraith.InstalledGame) => gameName(a).localeCompare(gameName(b));
    const compare = {
      name: byName,
      store: (a: wraith.InstalledGame, b: wraith.InstalledGame) => a.store.label.localeCompare(b.store.label),
      played: (a: wraith.InstalledGame, b: wraith.InstalledGame) => (lastPlayed(b) ?? 0) - (lastPlayed(a) ?? 0),
    }[sort];
    return (f ? all.filter((g) => gameName(g).toLowerCase().includes(f)) : all).slice().sort((a, b) => compare(a, b) || byName(a, b));
  }, [props.games, filter, sort, lastPlayed]);

  return (
    <section className="view">
      <div className="toolbar">
        <input className="search" type="search" placeholder="Find a game" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
        <select value={sort} onChange={(e) => setSort(e.currentTarget.value as Sort)} aria-label="Sort games">
          <option value="played">Recently played</option>
          <option value="name">Name</option>
          <option value="store">Store</option>
        </select>
        <span className="spacer" />
        <button className="ghost" onClick={props.onRefresh} disabled={!props.ready} title="Look for games again">
          ↻ Refresh
        </button>
        <button onClick={props.onAdd} disabled={!props.ready} title="A game no store knows about, from its folder">
          + Add a game
        </button>
      </div>
      {props.error && <p className="error">Couldn't list your games: {props.error}</p>}
      {props.addError && <p className="error">Couldn't add it: {props.addError}</p>}
      {props.adding}
      <div className="scroll">
        {props.games === null ? (
          <p className="empty">{props.ready ? "Looking for your games..." : "Getting Wraith ready..."}</p>
        ) : props.games.length === 0 ? (
          <div className="empty">
            <p>No games found in Steam, GOG, Epic or Xbox.</p>
            <p className="sub">Got one somewhere else? Add it from its folder.</p>
            <button onClick={props.onAdd}>+ Add a game</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="empty">Nothing called that.</p>
        ) : (
          <ul className="games">{shown.map((g) => props.row(g))}</ul>
        )}
      </div>
    </section>
  );
}

function howItStarts(g: wraith.InstalledGame, plan: wraith.Launch, how: wraith.How): string {
  const store = g.store.label;
  if (how === "proxy") return "Puts Wraith's proxy DLL beside the game, then starts it, so the game loads Wraith itself.";
  const first = startLabel(g.dir, plan);
  switch (plan.start) {
    case "store":
      return `Starts it through ${store}, and Wraith goes in as the game starts.`;
    case "exe":
      return first ? `Starts ${first}, and Wraith goes in as the game starts after it.` : "Starts the game with Wraith in it from the start.";
    case "none":
      return `Start it from ${store} yourself, and Wraith goes in as the game starts.`;
  }
}

export function GameRow(props: {
  game: wraith.InstalledGame;
  /** Unix seconds. */
  lastPlayed: number | null;
  process?: wraith.RunningProcess;
  action?: ActionState;
  choice: GameChoice;
  plan: wraith.Launch;
  proxy: string | null;
  exeAntiCheat: wraith.AntiCheat[];
  exeGameEngine: wraith.GameEngine | null;
  onInject: (p: wraith.RunningProcess) => void;
  onPlay: () => void;
  onPickExe: () => void;
  onHow: (how: wraith.How) => void;
  mods: wraith.Mod[];
  modsOpen: boolean;
  onMods: () => void;
  onRemove?: () => void;
  /** Under the row: the exe picker, the anti-cheat question or its mods. */
  below: React.ReactNode;
  art?: string | null;
}) {
  const { game: g, process: p, action, choice, plan, proxy } = props;
  const [settings, setSettings] = useState(false);
  const busy = action?.state === "busy" ? action : null;
  const waits = choice.how === "inject" && plan.start === "none";
  const updates = props.mods.filter(wraith.hasUpdate).length;
  const installed = props.mods.filter((m) => m.installed).length;
  const name = gameName(g);

  let main: React.ReactNode;
  if (busy) {
    main = (
      <>
        <span className="busy">{busy.label}</span>
        {busy.cancel && (
          <button className="ghost" onClick={busy.cancel}>
            Cancel
          </button>
        )}
      </>
    );
  } else if (p) {
    main = (
      <button className="primary" onClick={() => props.onInject(p)} title={p.wraith ? "Load Wraith and its mods again" : "It's running, so Wraith goes in now"}>
        {p.wraith ? "Reload Wraith" : "Add Wraith"}
      </button>
    );
  } else {
    main = (
      <button className="primary play" onClick={props.onPlay} title={howItStarts(g, plan, choice.how)}>
        {waits ? "Wait for it" : "▶ Play"}
      </button>
    );
  }

  return (
    <li className={`game${p ? " is-running" : ""}`}>
      <div className="game-row">
        <Tile name={name} art={props.art} />
        <div className="game-info">
          <div className="game-name" title={g.dir}>
            {name}
          </div>
          <div className="chips">
            <span className="chip">{g.store.label}</span>
            <GameEngineHint found={props.exeGameEngine ?? g.game_engine} />
            <AntiCheatHints found={mergeAntiCheat(g.anticheat, props.exeAntiCheat)} />
          </div>
          <div className="sub">
            {props.lastPlayed ? `Played ${formatAgo(props.lastPlayed)}` : "Not played with Wraith yet"}
            {props.mods.length > 0 && (
              <>
                {" · "}
                <button className="link" onClick={props.onMods}>
                  {props.modsOpen ? "Hide mods" : `${props.mods.length} ${props.mods.length === 1 ? "mod" : "mods"}${installed ? `, ${installed} installed` : ""}`}
                </button>
                {updates > 0 && <span className="badge">{updates === 1 ? "update" : `${updates} updates`}</span>}
              </>
            )}
          </div>
        </div>
        <div className="game-actions">
          {p?.wraith && <span className="state ok">● Wraith is in</span>}
          {p && !p.wraith && !busy && <span className="state">● Running</span>}
          {action?.state === "failed" && <span className="error">{action.error}</span>}
          {main}
          <button className={`ghost icon${settings ? " on" : ""}`} onClick={() => setSettings(!settings)} title="How it starts" aria-expanded={settings}>
            ⚙
          </button>
        </div>
      </div>
      {settings && (
        <div className="panel settings">
          <div className="setting">
            <span className="label">The game</span>
            <span>
              {startLabel(g.dir, plan) && <span className="sub">starts {startLabel(g.dir, plan)}, then </span>}
              {plan.game_exe ? <code>{relativeTo(g.dir, plan.game_exe)}</code> : <span className="sub">asked when you play</span>}
            </span>
            <button className="link" onClick={props.onPickExe} disabled={!!busy}>
              {plan.game_exe ? "Change" : "Choose now"}
            </button>
          </div>
          <div className="setting">
            <span className="label">Wraith goes in</span>
            <div className="segmented" role="radiogroup">
              <button className={choice.how === "inject" ? "on" : undefined} onClick={() => props.onHow("inject")} disabled={!!busy} role="radio" aria-checked={choice.how === "inject"}>
                As it starts
              </button>
              <button className={choice.how === "proxy" ? "on" : undefined} onClick={() => props.onHow("proxy")} disabled={!!busy} role="radio" aria-checked={choice.how === "proxy"}>
                With a proxy DLL
              </button>
            </div>
          </div>
          <p className="sub">
            {howItStarts(g, plan, choice.how)}
            {choice.how === "inject" && " Best for most games."}
            {choice.how === "proxy" && " For games that won't let Wraith in as they start. It stays until you switch back."}
            {proxy && ` Wraith's ${proxy} is beside it now.`}
          </p>
          <div className="setting">
            <span className="label">Folder</span>
            <code className="path">{g.dir}</code>
          </div>
          {props.onRemove && (
            <button className="ghost" onClick={props.onRemove} disabled={!!busy} title="Nothing's deleted, it just goes off the list">
              Take it off the list
            </button>
          )}
        </div>
      )}
      {props.below}
    </li>
  );
}
