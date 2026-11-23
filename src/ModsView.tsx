// Mods from the Wraith Hub: what's out for the player's games, what they have, and updates.

import { useMemo, useState } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import * as wraith from "./wraith";
import { type ActionState } from "./common";

export const hubUrl = "https://hub.wraith.io";

type Show = "yours" | "installed" | "all";

/** Installed first, then recommended, then ones for the player's games, then the rest. */
const rank = (p: wraith.Mod) => (p.installed ? 0 : p.featured ? 1 : p.games.length > 0 ? 2 : p.any_game ? 3 : 4);

export function ModsView(props: {
  catalog: wraith.ModCatalog | null;
  error: string | null;
  games: wraith.Game[];
  gameName: (id: string) => string;
  ready: boolean;
  actions: Record<string, ActionState>;
  onRefresh: () => void;
  onChange: (name: string, change: "install" | "remove") => void;
  onUpdateAll: () => void;
  /** From a wraith://install link. */
  asked: string | null;
  onDismissAsked: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<Show>("yours");
  const mods = props.catalog?.mods ?? [];
  const askedMod = props.asked ? mods.find((p) => p.id === props.asked) : undefined;
  // Libraries come with the mods that need them, so they're only shown once installed
  const offered = (p: wraith.Mod) => !p.library || !!p.installed;
  const counts = {
    yours: mods.filter((p) => offered(p) && (p.games.length > 0 || p.any_game || p.installed)).length,
    installed: mods.filter((p) => p.installed).length,
    all: mods.filter(offered).length,
  };
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return mods
      .filter(offered)
      .filter((p) => (show === "installed" ? p.installed : show === "yours" ? p.games.length > 0 || p.any_game || p.installed : true))
      .filter((p) => !f || `${p.title} ${p.id} ${p.summary} ${p.author}`.toLowerCase().includes(f))
      .sort((a, b) => rank(a) - rank(b) || (a.title || a.id).localeCompare(b.title || b.id));
  }, [mods, filter, show]);
  const updates = mods.filter(wraith.hasUpdate).length;
  const updating = props.actions["mods"];
  const forWhat = (p: wraith.Mod) =>
    p.any_game ? "Any game" : p.games.length > 0 ? p.games.map(props.gameName).join(", ") : "None of your games";

  return (
    <section className="view">
      {props.asked && (
        <div className="panel asked">
          <div className="row spread">
            <strong>From the hub</strong>
            <button className="ghost" onClick={props.onDismissAsked}>
              Close
            </button>
          </div>
          {props.catalog === null ? (
            <p className="sub">Getting mods from the hub...</p>
          ) : askedMod ? (
            <>
              <p className="sub">You asked to install this. Check it's the one you meant, then install it.</p>
              <ModCard mod={askedMod} forWhat={forWhat(askedMod)} action={props.actions[`mod:${askedMod.id}`]} onChange={props.onChange} />
            </>
          ) : (
            <p className="error">
              The hub has no mod called <code>{props.asked}</code>, or none this Wraith can run. Refresh in case it's new.
            </p>
          )}
        </div>
      )}
      {updates > 0 && (
        <div className="panel updates row">
          <span>
            {updates === 1 ? "1 mod has an update." : `${updates} mods have updates.`}
          </span>
          <span className="spacer" />
          {updating?.state === "busy" ? <span className="busy">{updating.label}</span> : <button className="primary" onClick={props.onUpdateAll}>Update all</button>}
        </div>
      )}
      {updating?.state === "failed" && <p className="error">{updating.error}</p>}
      <div className="toolbar">
        <div className="segmented">
          {(
            [
              ["yours", "For your games"],
              ["installed", "Installed"],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={show === id ? "on" : undefined} onClick={() => setShow(id)}>
              {label} <span className="count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Find a mod" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
        <span className="spacer" />
        <button className="ghost" onClick={() => void openUrl(`${hubUrl}/mods`)} title="See every mod, with pictures">
          Browse the hub ↗
        </button>
        <button className="ghost" onClick={props.onRefresh} disabled={!props.ready}>
          ↻ Refresh
        </button>
      </div>
      {props.error && <p className="error">Couldn't get mods from the hub: {props.error}</p>}
      <div className="scroll">
        {props.catalog === null ? (
          <p className="empty">{props.ready ? "Getting mods from the hub..." : "Getting Wraith ready..."}</p>
        ) : shown.length === 0 ? (
          <div className="empty">
            <p>
              {filter
                ? "No mods match that."
                : show === "installed"
                  ? "You haven't installed any mods yet."
                  : show === "yours"
                    ? "Nothing on the hub for your games yet."
                    : "Nothing's on the hub yet."}
            </p>
            {show !== "all" && !filter && (
              <button className="ghost" onClick={() => setShow("all")}>
                See all mods
              </button>
            )}
          </div>
        ) : (
          <ul className="mods">
            {shown.map((p) => (
              <li key={p.id}>
                <ModCard mod={p} forWhat={forWhat(p)} action={props.actions[`mod:${p.id}`]} onChange={props.onChange} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {props.catalog && (
        <p className="sub foot">
          They go in{" "}
          <button className="link" onClick={() => void revealItemInDir(props.catalog!.mods_dir)} title="Show it in Explorer">
            {props.catalog.mods_dir}
          </button>
          . Wraith loads them into your games for you.
        </p>
      )}
    </section>
  );
}

function ModCard(props: { mod: wraith.Mod; forWhat: string; action?: ActionState; onChange: (name: string, change: "install" | "remove") => void }) {
  const { mod: p, action } = props;
  const busy = action?.state === "busy" ? action : null;
  return (
    <div className={`mod${p.installed ? " is-installed" : ""}`}>
      <div className="mod-top">
        <div>
          <button className="mod-title link" onClick={() => void openUrl(`${hubUrl}/mods/${encodeURIComponent(p.id)}`)} title="Its page on the hub">
            {p.title || p.id}
          </button>
          <div className="sub">by {p.author}</div>
        </div>
        <div className="chips">
          {p.featured && (
            <span className="chip chip-accent" title={p.why ?? undefined}>
              Recommended
            </span>
          )}
          {p.kind === "project" && <span className="chip">Project</span>}
          {p.essential && (
            <span className="chip" title="Wraith keeps it installed and up to date for games made with this engine. Turn it off for a game from Mods in the overlay">
              Engine support
            </span>
          )}
          {p.library && (
            <span className="chip" title="Other mods use it, and it came with them">
              Library
            </span>
          )}
          {p.installed && <span className="chip chip-ok">Installed {p.installed}</span>}
          {p.revoked && (
            <span className="chip chip-bad" title="Wraith won't load it. Update or remove it">
              Pulled from the hub
            </span>
          )}
        </div>
      </div>
      <p className="mod-summary">{p.summary}</p>
      <div className="mod-bottom">
        <span className="sub">{props.forWhat}</span>
        <span className="spacer" />
        {action?.state === "failed" && <span className="error">{action.error}</span>}
        {busy ? (
          <span className="busy">{busy.label}</span>
        ) : (
          <>
            {!p.installed && p.latest && (
              <button className="primary" onClick={() => props.onChange(p.id, "install")}>
                Install
              </button>
            )}
            {!p.latest && p.outdated && <span className="note">Not updated for this Wraith yet</span>}
            {!p.latest && !p.installed && !p.outdated && <span className="note">{p.needs_wraith ? `Needs Wraith ${p.needs_wraith}` : "Needs a newer Wraith"}</span>}
            {wraith.hasUpdate(p) && (
              <button className="primary" onClick={() => props.onChange(p.id, "install")}>
                {p.revoked ? "Replace with" : "Update to"} {p.latest}
              </button>
            )}
            {/* Mods built on a library need it, and Wraith puts an essential one back, so neither is one to take out */}
            {p.installed && !p.library && !p.essential && (
              <button className="ghost" onClick={() => props.onChange(p.id, "remove")}>
                Remove
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Under a game: just its mods, in a compact list. */
export function GameMods(props: {
  mods: wraith.Mod[];
  running: boolean;
  actions: Record<string, ActionState>;
  onChange: (name: string, change: "install" | "remove") => void;
}) {
  return (
    <div className="panel">
      {props.running && <p className="sub">Wraith is in the game, so changes reach it once the mod's reloaded, from Mods in the overlay.</p>}
      <ul className="mods compact">
        {props.mods.map((p) => (
          <li key={p.id}>
            <ModCard mod={p} forWhat={p.any_game ? "Any game" : ""} action={props.actions[`mod:${p.id}`]} onChange={props.onChange} />
          </li>
        ))}
      </ul>
    </div>
  );
}
