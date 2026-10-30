#!/usr/bin/env node
/**
 * Pre-publish sanity check for dsh-dscost-tide.
 *
 * Verifies the package still looks like a loadable DSH bundle before it goes to
 * the registry: the manifest fields the Host needs, the files the manifest
 * promises, and no leftover local-only values.
 *
 *   node scripts/check-publish.mjs
 *
 * Exit code 0 = ready, 1 = blocking problem, warnings alone still exit 0.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const problems = [];
const warnings = [];

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

/* ------------------------------------------------------------- manifest  */

if (typeof pkg.name !== "string" || pkg.name.length === 0) problems.push("package.json: name is missing");
if (pkg.private === true) problems.push("package.json: private:true blocks publishing");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(pkg.version))) {
	problems.push(`package.json: version ${JSON.stringify(pkg.version)} is not a semver version`);
}
if (pkg.license !== "MIT") warnings.push(`license is ${JSON.stringify(pkg.license)} (README claims MIT)`);

const dsh = pkg.dsh ?? {};
if (dsh.bundle?.patch !== "./cordis.patch.yml") {
	problems.push("package.json: dsh.bundle.patch must point at ./cordis.patch.yml");
}
if (dsh.client?.platform !== "web") {
	problems.push('package.json: dsh.client.platform must be "web" (this plugin has no host-only mode)');
}
if (typeof pkg.engines?.dsh !== "string") {
	warnings.push("package.json: engines.dsh is missing — the plugin market cannot match compatibility");
}

const listed = Array.isArray(pkg.files) ? pkg.files : [];
for (const required of ["lib/", "cordis.patch.yml", "README.md", "LICENSE"]) {
	if (!listed.includes(required)) problems.push(`package.json: files[] should include ${required}`);
}

/* ----------------------------------------------------------------- files  */

const shipped = [
	"lib/index.js",
	"lib/client.js",
	"cordis.patch.yml",
	"README.md",
	"README.en.md",
	"CHANGELOG.md",
	"LICENSE"
];
for (const file of shipped) {
	try {
		const info = await stat(path.join(root, file));
		if (!info.isFile() || info.size === 0) problems.push(`${file}: missing or empty`);
	} catch {
		problems.push(`${file}: missing`);
	}
}

/* -------------------------------------------------------------- leftovers */

const serialized = JSON.stringify(pkg);
for (const field of ["homepage", "repository", "bugs"]) {
	const value = field === "repository" ? pkg.repository?.url : pkg[field];
	if (typeof value === "string" && value.includes("your-github-name")) {
		warnings.push(`package.json: ${field} still contains the your-github-name placeholder`);
	}
}
if (serialized.includes("file:") && Object.keys(pkg.dependencies ?? {}).length > 0) {
	problems.push("package.json: dependencies must not use file: specs (they break for consumers)");
}

/* ----------------------------------------------------------------- report */

for (const warning of warnings) console.log(`warn  ${warning}`);
for (const problem of problems) console.log(`FAIL  ${problem}`);
if (problems.length === 0) {
	console.log(`ok    ${pkg.name}@${pkg.version} looks publishable (${shipped.length} shipped files)`);
	process.exit(0);
}
console.log(`\n${problems.length} blocking problem(s); fix them before publishing.`);
process.exit(1);
