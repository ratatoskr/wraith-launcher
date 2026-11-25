// For making mods: the plugins you're building, the wraith command and the log.

import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as wraith from "./wraith";
import { errorText } from "./common";

export type LogLine = Extract<wraith.WraithEvent, { event: "log" }> & { key: number };

export function DevView(props: { log: LogLine[]; ready: boolean }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [props.log]);
  const problems = props.log.filter((l) => l.level === "err" || l.level === "warn").length;

  return (
    <section className="view more">
      <Overrides ready={props.ready} />

      <div className="card">
        <h2>Which Wraith</h2>
        <ExePicker />
      </div>

      <div className="card">
        <h2>The wraith command</h2>
        <CliToggle />
      </div>

      <details className="card" open>
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
    </section>
  );
}

/** What `wraith dev add` lists. Switched off ones stay till their folder goes or they're taken off. Wraith keeps the lists. */
function Overrides(props: { ready: boolean }) {
  const [found, setFound] = useState<wraith.DevPlugins | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = (work: Promise<wraith.DevPlugins>) => {
    setError(null);
    work.then(setFound, (e) =>
      setError(e instanceof wraith.WraithError && e.code === "UnknownMethod" ? "This Wraith is too old to list them. Update it, or pick a newer wraith.exe below." : errorText(e)),
    );
  };
  const refresh = () => change(wraith.devPlugins());
  useEffect(() => {
    if (props.ready) refresh();
  }, [props.ready]);

  async function add() {
    const dir = await openDialog({ directory: true, title: "The plugin's build folder, with its wraith.json" });
    if (typeof dir === "string") change(wraith.addDevPlugin(dir));
  }

  return (
    <div className="card">
      <h2>Overrides</h2>
      <p className="sub">
        Plugins you're building, loaded from these folders besides the installed ones. Same as <code>wraith dev add</code>. A game
        that's running picks up changes when you Rescan in its Plugins window.
      </p>
      <div className="toolbar">
        <span className="spacer" />
        <button className="ghost" onClick={refresh} disabled={!props.ready}>
          ↻ Refresh
        </button>
        <button onClick={() => void add()} disabled={!props.ready}>
          Add folder
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <ul className="processes">
        {!props.ready && !found && <li className="empty">Waiting for Wraith...</li>}
        {found?.plugins.length === 0 && <li className="empty">None yet.</li>}
        {found?.plugins.map((p) => (
          <li key={p.folder}>
            <div className={`process${p.on ? "" : " off"}`}>
              <label className="check dev-plugin" title={p.on ? "Wraith loads it" : "Wraith skips it"}>
                <input type="checkbox" checked={p.on} disabled={!props.ready} onChange={(e) => change(wraith.setDevPlugin(p.folder, e.currentTarget.checked))} />
                <span>
                  <strong>{p.name ?? "?"}</strong> <span className="sub">{p.folder}</span>
                  {p.problem && <span className="note"> {p.problem}</span>}
                </span>
              </label>
              <button
                className="ghost"
                onClick={() => change(wraith.removeDevPlugin(p.folder))}
                disabled={!props.ready}
                title="Nothing's deleted, it just goes off the list"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
        {found?.followed.map((f) => (
          <li key={f.dir}>
            <div className="process followed" title="Loaded from its build too, since a dev plugin's devDepends name it">
              <span className="dev-plugin">
                <strong>{f.name}</strong> <span className="sub">{f.dir}</span> <span className="chip chip-dim">devDepends of {f.by}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A wraith.exe you built, instead of the installed one. Like setting `WRAITH`. */
function ExePicker() {
  const [exe, setExe] = useState<wraith.WraithExe | null>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    wraith.wraithExe().then(setExe, (e) => setError(errorText(e)));
  }, []);
  const save = (path: string | null) => {
    setError(null);
    wraith.setWraithExe(path).then(
      (next) => {
        setExe(next);
        setChanged(true);
      },
      (e) => setError(errorText(e)),
    );
  };
  async function pick() {
    const path = await openDialog({ title: "Your wraith.exe", filters: [{ name: "wraith.exe", extensions: ["exe"] }] });
    if (typeof path === "string") save(path);
  }

  return (
    <>
      <p className="sub">
        Run a <code>wraith.exe</code> you built (zig-out\bin) instead of the installed one. The <code>wraith</code> command uses it too.
      </p>
      <div className="toolbar">
        {exe?.saved ? <code className="path">{exe.saved}</code> : <span className="sub">The installed one</span>}
        <span className="spacer" />
        {exe?.saved && (
          <button className="ghost" onClick={() => save(null)}>
            Use the installed one
          </button>
        )}
        <button onClick={() => void pick()}>Pick wraith.exe</button>
      </div>
      {exe?.env && <p className="note">WRAITH is set to {exe.env}, so that one's used instead.</p>}
      {changed && <p className="note">Restart the launcher to switch to it.</p>}
      {error && <p className="error">{error}</p>}
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
