#!/usr/bin/env node
/**
 * Build the *publishable* copy of this package and pack it.
 *
 * The working tree keeps `"name": "dsh-dscost-tide"` because a local profile
 * installs it with `link:` — renaming the package in place would desync the
 * profile's dependency key and its `dsh.profile.bundles` entry. This script
 * copies only the shipped files into `_intermediate/publish/`, rewrites the
 * manifest (name and repository URLs), then runs `pnpm pack` / `npm pack` and
 * prints the tarball contents.
 *
 *   node scripts/prepare-publish.mjs
 *   node scripts/prepare-publish.mjs --name @your-username/dsh-dscost-tide
 *   node scripts/prepare-publish.mjs --repo your-username/dsh-dscost-tide
 *   node scripts/prepare-publish.mjs --pnpm "C:/path/to/pnpm.cjs"
 *
 * Options:
 *   --name <name>     published package name (default: current package.json name)
 *   --repo <owner/repo>  rewrites repository / homepage / bugs
 *   --out <dir>       output directory (default: _intermediate/publish)
 *   --pnpm <file>     path to pnpm.cjs (run with this Node)
 *   --npm <file>      path to npm-cli.js (run with this Node)
 *   --no-pack         only build the directory
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

function argv(name, fallback = undefined) {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const value = process.argv[index + 1];
	if (value === undefined || value.startsWith("--")) return true;
	return value;
}

const SHIPPED = ["lib", "cordis.patch.yml", "README.md", "README.en.md", "CHANGELOG.md", "LICENSE"];
const outDir = path.resolve(root, argv("out", path.join(root, "_intermediate", "publish")));
const name = argv("name", undefined);
const repo = argv("repo", undefined);
const packWith = argv("pnpm", undefined) ?? argv("npm", undefined);
const shouldPack = argv("no-pack", false) !== true;

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

if (typeof name === "string") pkg.name = name;
if (typeof repo === "string") {
	const slug = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
	pkg.repository = { type: "git", url: `git+https://github.com/${slug}.git` };
	pkg.homepage = `https://github.com/${slug}#readme`;
	pkg.bugs = { url: `https://github.com/${slug}/issues` };
}

/* ------------------------------------------------------------ build tree  */

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
for (const entry of SHIPPED) {
	await cp(path.join(root, entry), path.join(outDir, entry), { recursive: true });
}
await writeFile(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");

console.log(`prepared ${pkg.name}@${pkg.version} in ${outDir}`);
for (const entry of SHIPPED) console.log(`  + ${entry}`);

/* ------------------------------------------------------------------ pack  */

if (!shouldPack) process.exit(0);

const runner = typeof packWith === "string" && packWith.length > 0
	? { command: process.execPath, args: [path.resolve(packWith)] }
	: null;

function run(command, args) {
	const result = spawnSync(command, args, { cwd: outDir, encoding: "utf8" });
	if (result.error !== undefined && result.error !== null) {
		return { ok: false, output: String(result.error.message ?? result.error) };
	}
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return { ok: result.status === 0, output };
}

let packed = runner === null
	? run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["pack"])
	: run(runner.command, [...runner.args, "pack"]);

if (!packed.ok) {
	// Fall back to npm when the first package manager is unavailable.
	packed = run(process.platform === "win32" ? "npm.cmd" : "npm", ["pack"]);
}
if (!packed.ok) {
	console.log("\npack failed — pass --pnpm <path-to-pnpm.cjs> or --npm <path-to-npm-cli.js>:");
	console.log(packed.output);
	process.exit(1);
}
console.log(`\n${packed.output}`);

/* --------------------------------------------------------- list contents  */

const tarballs = (await readdir(outDir)).filter((file) => file.endsWith(".tgz"));
if (tarballs.length === 0) {
	console.log("no tarball found; nothing to list");
	process.exit(0);
}
for (const tarball of tarballs) {
	const listed = spawnSync("tar", ["-tzf", path.join(outDir, tarball)], { encoding: "utf8" });
	if (listed.error !== undefined && listed.error !== null) {
		console.log(`(${tarball} created; tar not available to list it)`);
		continue;
	}
	const files = String(listed.stdout ?? "").trim().split(/\r?\n/).filter((line) => line.length > 0);
	console.log(`\n${tarball}: ${files.length} entries`);
	for (const file of files) console.log(`  ${file}`);
}
