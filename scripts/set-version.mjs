// Usage: node scripts/set-version.mjs 0.0.2
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    console.error("usage: node scripts/set-version.mjs <version>, like 1.2.3 or 1.2.3-alpha.1");
    process.exit(1);
}

// Each pattern must match exactly once, so a moved field fails loudly instead of being skipped
const edits = {
    "package.json": [/^(  "version": )"[^"]*"/m],
    "package-lock.json": [/^(  "version": )"[^"]*"/m, /^(      "name": "wraith-launcher",\r?\n      "version": )"[^"]*"/m],
    "src-tauri/tauri.conf.json": [/^(  "version": )"[^"]*"/m],
    "src-tauri/Cargo.toml": [/^(\[package\]\r?\nname = "wraith-launcher"\r?\nversion = )"[^"]*"/m],
    "src-tauri/Cargo.lock": [/^(name = "wraith-launcher"\r?\nversion = )"[^"]*"/m],
};

for (const [file, patterns] of Object.entries(edits)) {
    const path = join(root, file);
    let text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
        const global = new RegExp(pattern.source, "gm");
        const count = [...text.matchAll(global)].length;
        if (count !== 1) throw new Error(`${file}: expected one match for ${pattern}, found ${count}`);
        text = text.replace(pattern, `$1"${version}"`);
    }
    writeFileSync(path, text);
    console.log(`${file}: ${version}`);
}
