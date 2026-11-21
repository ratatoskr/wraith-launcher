// Self-update with Tauri's updater. Skipped in dev builds. Updates aren't optional,
// so one found takes over the window until it's in.

import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";

type State =
  | { state: "none" }
  | { state: "downloading"; version: string; done: number; total?: number }
  | { state: "failed"; update: Update; error: string };

/** Greys out the app with a message on top. */
export function Blocker(props: { title: string; children?: React.ReactNode }) {
  return (
    <div className="blocker">
      <div className="blocker-card">
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

export function Progress(props: { done?: number; total?: number }) {
  const known = props.total !== undefined && props.done !== undefined;
  return (
    <div className={`progress${known ? "" : " progress-unknown"}`}>
      <div style={known ? { width: `${Math.floor((props.done! / props.total!) * 100)}%` } : undefined} />
    </div>
  );
}

export function LauncherUpdate() {
  const [state, setState] = useState<State>({ state: "none" });

  const install = useCallback(async (update: Update) => {
    let done = 0;
    let total: number | undefined;
    setState({ state: "downloading", version: update.version, done });
    try {
      // Windows closes the app to run the installer, which restarts it after
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") done += event.data.chunkLength;
        setState({ state: "downloading", version: update.version, done, total });
      });
    } catch (e) {
      setState({ state: "failed", update, error: String(e) });
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    check()
      .then((update) => update && install(update))
      // Offline or nothing published yet
      .catch((e) => console.warn("Couldn't check for a launcher update:", e));
  }, [install]);

  switch (state.state) {
    case "none":
      return null;
    case "downloading":
      return (
        <Blocker title={`Updating the launcher to ${state.version}`}>
          <p>It restarts once it's done.</p>
          <Progress done={state.done} total={state.total} />
        </Blocker>
      );
    case "failed":
      return (
        <Blocker title={`Couldn't update the launcher to ${state.update.version}`}>
          <p className="error">{state.error}</p>
          <button onClick={() => install(state.update)}>Try again</button>
        </Blocker>
      );
  }
}
