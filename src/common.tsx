// Small things the views share: names, times, hints and the panels that open under a row.

import * as wraith from "./wraith";

/** By row key. `cancel` stops one still waiting for a game to start. */
export type ActionState = { state: "busy"; label: string; cancel?: () => void } | { state: "failed"; error: string };

/** Something waiting for the player to OK the anti-cheat risk. */
export type Pending = { key: string; name: string; found: wraith.AntiCheat[]; run: () => void };

/** `played` is unix seconds. */
export type GameChoice = { exe?: string; how: wraith.How; played?: number };

export const processKey = (p: wraith.RunningProcess) => `pid:${p.pid}`;
export const gameKey = (g: wraith.Game) => `game:${g.id}`;

/** Case-insensitive like Windows. */
export function isWithin(dir: string, path: string): boolean {
  const d = dir.replace(/[\\/]+$/, "").toLowerCase().replace(/\//g, "\\");
  const p = path.toLowerCase().replace(/\//g, "\\");
  return p.startsWith(d + "\\");
}

/** Picks the likeliest game started from its folder. */
export function runningAs(processes: wraith.RunningProcess[], g: wraith.Game): wraith.RunningProcess | undefined {
  return processes.filter((p) => p.path && isWithin(g.dir, p.path)).sort((a, b) => b.score - a.score)[0];
}

export function gameName(g: wraith.Game): string {
  return g.name ?? g.known?.label ?? g.id;
}

export function relativeTo(dir: string, path: string): string {
  return isWithin(dir, path) ? path.slice(dir.replace(/[\\/]+$/, "").length + 1) : path;
}

/** Relative to the game's folder, or just the file name if elsewhere. */
export function startLabel(dir: string, launch: wraith.Launch): string | null {
  if (launch.start !== "exe" || !launch.exe || launch.starts_game) return null;
  return isWithin(dir, launch.exe) ? relativeTo(dir, launch.exe) : launch.exe.split(/[\\/]/).pop()!;
}

export function formatSize(bytes: number): string {
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatAgo(seconds: number): string {
  const days = Math.round((seconds * 1000 - Date.now()) / 86_400_000);
  if (days > -1) return "today";
  if (days > -14) return relativeTime.format(days, "day");
  if (days > -60) return relativeTime.format(Math.round(days / 7), "week");
  if (days > -730) return relativeTime.format(Math.round(days / 30), "month");
  return relativeTime.format(Math.round(days / 365), "year");
}

/** Wraith's error codes, said so a player gets them. Unknown ones show as they are. */
const errorWords: Record<string, string> = {
  WraithNotRunning: "Wraith isn't running. Restart the launcher.",
  AccessDenied: "Windows said no. The game may be running as administrator, so try running Wraith as administrator too.",
  NotFound: "It's not there any more.",
  Canceled: "Stopped.",
  NotAFolder: "That's not a folder.",
};

export function errorText(e: unknown): string {
  const code = e instanceof wraith.WraithError ? e.code : String(e);
  return errorWords[code] ?? code;
}

export function antiCheatList(found: wraith.AntiCheat[]): string {
  return found.map((ac) => ac.product.label).join(", ");
}

/** One per product. */
export function mergeAntiCheat(a: wraith.AntiCheat[], b: wraith.AntiCheat[]): wraith.AntiCheat[] {
  return [...a, ...b.filter((ac) => !a.some((x) => x.product.id === ac.product.id))];
}

/** A steady colour per name, for tiles without art. */
export function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** First letters of the first two words that matter, like "RR" for Risk of Rain. */
export function initials(name: string): string {
  const small = new Set(["of", "the", "a", "an", "and", "in", "on", "to"]);
  const all = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const words = all.filter((w, i) => i === 0 || !small.has(w.toLowerCase()));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** The game's art if its store keeps any here, else its initials on a colour of its own. */
export function Tile(props: { name: string; art?: string | null; size?: "big" | "small" }) {
  if (props.art) return <img className={`tile tile-art tile-${props.size ?? "big"}`} src={props.art} alt="" aria-hidden />;
  return (
    <div className={`tile tile-${props.size ?? "big"}`} style={{ "--hue": hueOf(props.name) } as React.CSSProperties} aria-hidden>
      {initials(props.name)}
    </div>
  );
}

export function GameEngineHint(props: { found: wraith.GameEngine | null }) {
  const e = props.found;
  if (!e) return null;
  const extra = [e.version, e.variant].filter(Boolean).join(" · ");
  return (
    <span className="chip" title={`Found ${e.file}${extra ? ` (${extra})` : ""}`}>
      {e.game_engine.label}
      {e.variant && ` ${e.variant}`}
    </span>
  );
}

export function AntiCheatHints(props: { found: wraith.AntiCheat[] }) {
  return props.found.map((ac) => (
    <span key={ac.product.id} className="chip chip-warn" title={`Anti-cheat. Found ${ac.file}`}>
      ⚠ {ac.product.label}
    </span>
  ));
}

/** Under a row, before anything goes into a game anti-cheat watches. */
export function ConfirmPanel(props: { pending: Pending; running: wraith.AntiCheat[]; onCancel: () => void }) {
  const { pending, running } = props;
  return (
    <div className="panel panel-warn" role="alertdialog">
      <p>
        {pending.found.length !== 0 ? (
          <>
            <strong>{pending.name}</strong> is protected by {antiCheatList(pending.found)}.
          </>
        ) : (
          <>Anti-cheat is running on this PC: {antiCheatList(running)}.</>
        )}{" "}
        It may notice Wraith, and that can get an account banned. Only go on if you know this game's fine with it, like
        when it's single-player or offline.
      </p>
      <div className="row">
        <button className="danger" onClick={pending.run}>
          Go on anyway
        </button>
        <button className="ghost" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Stores often start a launcher instead of the game. */
export function ExePicker(props: {
  dir: string;
  store: wraith.Named | null;
  exes: wraith.Exe[];
  onPick: (exe: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="panel">
      <p>Which one is the game? Wraith goes into the one you pick, and leaves any launcher before it alone.</p>
      <ul className="choices">
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
      <button className="ghost" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}
