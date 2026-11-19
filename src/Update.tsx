// Self-update with Tauri's updater. Skipped in dev builds.

import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";

type State =
  | { state: "none" }
  | { state: "available"; update: Update }
  | { state: "downloading"; version: string; done: number; total?: number }
  | { state: "failed"; error: string };

export function UpdateBanner() {
  const [state, setState] = useState<State>({ state: "none" });

  useEffect(() => {
    if (import.meta.env.DEV) return;
    check()
      .then((update) => update && setState({ state: "available", update }))
      // Offline or nothing published yet
      .catch((e) => console.warn("Couldn't check for an app update:", e));
  }, []);

  async function install(update: Update) {
    let done = 0;
    let total: number | undefined;
    try {
      // Windows closes the app to run the installer, which restarts it after
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") done += event.data.chunkLength;
        setState({ state: "downloading", version: update.version, done, total });
      });
    } catch (e) {
      setState({ state: "failed", error: String(e) });
    }
  }

  switch (state.state) {
    case "none":
      return null;
    case "available":
      return (
        <div className="update">
          A new version of the app, {state.update.version}, is available.
          <button onClick={() => install(state.update)}>Update now</button>
        </div>
      );
    case "downloading":
      return (
        <div className="update">
          Downloading the app's update, {state.version}...
          {state.total ? ` ${Math.floor((state.done / state.total) * 100)}%` : ""}
        </div>
      );
    case "failed":
      return <div className="update error">Couldn't update the app: {state.error}</div>;
  }
}
