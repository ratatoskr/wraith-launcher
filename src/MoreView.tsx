// The rarer things: Wraith in a game that isn't listed, the wraith command, the log and versions.

import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as wraith from "./wraith";
import { type ActionState, AntiCheatHints, errorText, GameEngineHint } from "./common";
import { hubUrl } from "./ModsView";

export type LogLine = Extract<wraith.WraithEvent, { event: "log" }> & { key: number };

const docsUrl = "https://docs.wraith.io";

export function MoreView(props: {
  processes: wraith.RunningProcess[];
  listError: string | null;
  showAll: boolean;
  onShowAll: (all: boolean) => void;
  ready: boolean;
  onRefresh: () => void;
  actions: Record<string, ActionState>;
  onInject: (p: wraith.RunningProcess) => void;
  /** The anti-cheat question under a program, by its key. */
  confirmation: (p: wraith.RunningProcess) => React.ReactNode;
  log: LogLine[];
  launcherVersion: string | null;
  frameworkVersion: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [props.log]);
  const problems = props.log.filter((l) => l.level === "err" || l.level === "warn").length;

  return (
    <section className="view more">
      <div className="card">
        <h2>Wraith in something that's running</h2>
        <p className="sub">
          For a game that isn't in your list. Start it first, then add Wraith to it here. Likeliest games are first.
        </p>
        <div className="toolbar">
          <label className="check">
            <input type="checkbox" checked={props.showAll} onChange={(e) => props.onShowAll(e.currentTarget.checked)} />
            Show programs without a window too
          </label>
          <span className="spacer" />
          <button className="ghost" onClick={props.onRefresh} disabled={!props.ready}>
            ↻ Refresh
          </button>
        </div>
        {props.listError && <p className="error">Couldn't list what's running: {props.listError}</p>}
        <ul className="processes">
          {props.processes.length === 0 && <li className="empty">{props.ready ? "Nothing that looks like a game." : "Getting Wraith ready..."}</li>}
          {props.processes.map((p) => (
            <li key={p.pid} className={p.score <= 20 ? "unlikely" : undefined}>
              <ProcessRow process={p} action={props.actions[`pid:${p.pid}`]} onInject={() => props.onInject(p)} />
              {props.confirmation(p)}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Making mods</h2>
        <CliToggle />
        <p className="sub">
          The <code>wraith</code> command builds and tries plugins. See{" "}
          <button className="link" onClick={() => void openUrl(`${docsUrl}/plugins/`)}>
            writing plugins
          </button>
          .
        </p>
      </div>

      <details className="card">
        <summary>
          <h2>Log</h2>
          {problems > 0 && <span className="badge warn">{problems}</span>}
        </summary>
        <div className="log" ref={logRef}>
          {props.log.length === 0 && <div className="sub">Nothing yet.</div>}
          {props.log.map((line) => (
            <div key={line.key} className={`log-${line.level}`}>
              <span className="log-scope">{line.scope}</span> {line.message}
            </div>
          ))}
        </div>
      </details>

      <div className="card about">
        <h2>About</h2>
        <dl>
          <dt>Launcher</dt>
          {/* main is always 0.0.0, only releases get a real version */}
          <dd>{props.launcherVersion === null ? "..." : props.launcherVersion === "0.0.0" ? "dev build" : props.launcherVersion}</dd>
          <dt>Wraith</dt>
          <dd>{props.frameworkVersion}</dd>
        </dl>
        <p className="row">
          <button className="link" onClick={() => void openUrl(docsUrl)}>
            Docs
          </button>
          <button className="link" onClick={() => void openUrl(hubUrl)}>
            Wraith Hub
          </button>
          <button className="link" onClick={() => void openUrl(`${docsUrl}/about/privacy/`)}>
            Privacy
          </button>
          <button className="link" onClick={() => void openUrl("https://github.com/ratatoskr")}>
            GitHub
          </button>
        </p>
        <p className="sub">
          Made with <span className="heart">♥</span> by Asgard
        </p>
      </div>
    </section>
  );
}

function ProcessRow(props: { process: wraith.RunningProcess; action?: ActionState; onInject: () => void }) {
  const { process: p, action } = props;
  const busy = action?.state === "busy" ? action : null;
  return (
    <div className="process">
      <div className="process-info">
        <div title={p.path ?? undefined}>
          <strong>{p.name}</strong> <span className="sub">{p.arch ?? "?"} · pid {p.pid}</span>
        </div>
        <div className="chips">
          <GameEngineHint found={p.game_engine} />
          <AntiCheatHints found={p.anticheat} />
          {p.hints
            .filter((h) => !(p.game_engine && (h.id === "unity" || h.id === "unreal")))
            .map((h) => (
              <span key={h.id} className={`chip${h.id === "browser" ? " chip-dim" : ""}`}>
                {h.label}
              </span>
            ))}
        </div>
      </div>
      <div className="game-actions">
        {p.wraith && <span className="state ok">● Wraith is in</span>}
        {!p.inspected && p.windowed && (
          <span className="note" title="It's probably running as administrator. Run Wraith as administrator to add it">
            Admin?
          </span>
        )}
        {action?.state === "failed" && <span className="error">{action.error}</span>}
        <button onClick={props.onInject} disabled={!!busy}>
          {busy?.label ?? (p.wraith ? "Reload Wraith" : "Add Wraith")}
        </button>
      </div>
    </div>
  );
}

/** For `wraith dev add` and friends. */
function CliToggle() {
  const [cli, setCli] = useState<wraith.CliStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    wraith.cliStatus().then(setCli, (e) => setError(errorText(e)));
  }, []);
  if (!cli) return error ? <p className="error">{error}</p> : null;
  const toggle = (on: boolean) => {
    setError(null);
    wraith.setCliOnPath(on).then(setCli, (e) => setError(errorText(e)));
  };
  return (
    <p>
      <label className="check" title={`It's in ${cli.dir}. New terminals pick up the change`}>
        <input type="checkbox" checked={cli.on_path} onChange={(e) => toggle(e.currentTarget.checked)} />
        Put the <code>wraith</code> command on PATH
      </label>
      {error && <span className="error"> {error}</span>}
    </p>
  );
}
