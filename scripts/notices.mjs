// Writes THIRD_PARTY_NOTICES.md. Run it after changing dependencies.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri", "Cargo.toml");
const target = "x86_64-pc-windows-msvc";

const licenseFile = /^(licen[cs]e|copying|notice)/i;

/** For "X OR Y" we only need one, so MIT wins if it's there. */
function texts(dir, expression) {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => licenseFile.test(f)).sort() : [];
    const dual = /\bOR\b|\//.test(expression ?? "");
    const mit = files.filter((f) => /mit/i.test(f));
    const chosen = dual && mit.length ? mit : files;
    return chosen.map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim());
}

function crates() {
    const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", manifest, "--filter-platform", target], { encoding: "utf8", maxBuffer: 64 << 20 }));
    const byId = new Map(meta.packages.map((p) => [`${p.name} v${p.version}`, p]));
    // Only what ends up in the binary: no build scripts' or proc macros' dependencies
    const tree = execFileSync("cargo", ["tree", "--manifest-path", manifest, "--target", target, "-e", "normal,no-proc-macro", "--prefix", "none", "-f", "{p}"], { encoding: "utf8", maxBuffer: 64 << 20 });
    const seen = new Set();
    const out = [];
    for (const line of tree.split("\n")) {
        const key = line.replace(/\s*\(.*$/, "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const p = byId.get(key);
        if (!p || !p.source) continue; // our own crate
        out.push({ name: p.name, version: p.version, license: p.license ?? "unknown", url: p.repository ?? `https://crates.io/crates/${p.name}`, texts: texts(dirname(p.manifest_path), p.license) });
    }
    return out;
}

function npmPackages() {
    let json;
    try {
        json = execSync("npm ls --omit=dev --all --json", { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
    } catch (e) {
        json = e.stdout;
    }
    const out = new Map();
    const walk = (deps) => {
        for (const [name, d] of Object.entries(deps ?? {})) {
            const key = `${name}@${d.version}`;
            if (out.has(key)) continue;
            const dir = join(root, "node_modules", name);
            const pkg = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
            const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
            out.set(key, { name, version: d.version, license: pkg.license ?? "unknown", url: pkg.homepage ?? repo ?? `https://www.npmjs.com/package/${name}`, texts: texts(dir, pkg.license) });
            walk(d.dependencies);
        }
    };
    walk(JSON.parse(json).dependencies);
    return [...out.values()];
}

const all = [...crates(), ...npmPackages()];
all.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

// Group packages by their exact license text
const groups = new Map();
const missing = [];
for (const p of all) {
    if (!p.texts.length) {
        missing.push(p);
        continue;
    }
    const text = p.texts.join("\n\n---\n\n");
    if (!groups.has(text)) groups.set(text, []);
    groups.get(text).push(p);
}

const link = (url) => url.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "");
let md = "# Third-party notices\n\nThe Wraith app includes these Rust crates and npm packages. Thanks to everyone who works on them.\n\n";
md += "| Package | Version | License |\n|---|---|---|\n";
for (const p of all) md += `| [${p.name}](${link(p.url)}) | ${p.version} | ${p.license} |\n`;
if (missing.length) {
    md += "\nThese don't ship a license file, so the standard text of the license named above applies:\n\n";
    for (const p of missing) md += `- ${p.name} ${p.version} (${p.license})\n`;
}
md += "\n## License texts\n";
for (const [text, users] of groups) {
    md += `\nUsed by ${users.map((p) => `${p.name} ${p.version}`).join(", ")}.\n\n\`\`\`text\n${text}\n\`\`\`\n`;
}
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), md);
console.log(`${all.length} packages, ${groups.size} distinct license texts, ${missing.length} without a license file`);
