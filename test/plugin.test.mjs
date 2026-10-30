/**
 * dsh-dscost-tide — offline unit tests.
 *
 * Runs with `node --test test/plugin.test.mjs` on Node 22+ and needs no DSH runtime: both
 * halves are loaded in-process. The client half is a browser bundle, so the
 * test supplies the two globals it expects (`window.__ModuleLoader__`) and a
 * minimal fake `react`.
 */
import test from "node:test";
import assert from "node:assert/strict";


const HOST = new URL("../lib/index.js", import.meta.url);
const CLIENT = new URL("../lib/client.js", import.meta.url);

/* ------------------------------------------------------------------ host  */

const host = await import(HOST.href);
const { bjDayKey, isPeakAt, bandAt, priceUsage, foldEvents, rangeWindow, RANGES } = host;

/** Epoch ms for a Beijing wall-clock moment (UTC+8, no DST). */
function beijing(year, month, day, hour, minute = 0) {
	return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);
}

test("host: exports the documented pure helpers", () => {
	assert.equal(typeof bjDayKey, "function");
	assert.equal(typeof isPeakAt, "function");
	assert.equal(typeof bandAt, "function");
	assert.equal(typeof priceUsage, "function");
	assert.equal(typeof foldEvents, "function");
	assert.equal(typeof rangeWindow, "function");
	assert.deepEqual(RANGES, ["today", "7d", "30d", "all"]);
});

test("host: declares the services it consumes", () => {
	assert.deepEqual(host.inject, ["webServer", "sessionPersistence"]);
});

test("host: Beijing day key crosses midnight at +08:00", () => {
	assert.equal(bjDayKey(beijing(2026, 10, 5, 0, 30)), "2026-10-05");
	assert.equal(bjDayKey(Date.parse("2026-10-04T16:30:00Z")), "2026-10-05");
	assert.equal(bjDayKey(Date.parse("2026-10-04T15:30:00Z")), "2026-10-04");
});

test("host: peak windows are 09:00-12:00 and 14:00-18:00 on weekdays", () => {
	// 2026-10-05 is a Monday.
	assert.equal(isPeakAt(beijing(2026, 10, 5, 9, 0)), true);
	assert.equal(isPeakAt(beijing(2026, 10, 5, 11, 59)), true);
	assert.equal(isPeakAt(beijing(2026, 10, 5, 12, 0)), false);
	assert.equal(isPeakAt(beijing(2026, 10, 5, 14, 0)), true);
	assert.equal(isPeakAt(beijing(2026, 10, 5, 17, 59)), true);
	assert.equal(isPeakAt(beijing(2026, 10, 5, 18, 0)), false);
	assert.equal(isPeakAt(beijing(2026, 10, 5, 2, 0)), false);
});

test("host: weekends are entirely off-peak only from 2026-08-23", () => {
	// Saturday 2026-10-03 sits after the change: no peak at 10:00.
	assert.equal(isPeakAt(beijing(2026, 10, 3, 10, 0)), false);
	// Saturday 2026-08-22 still used the weekday windows.
	assert.equal(isPeakAt(beijing(2026, 8, 22, 10, 0)), true);
	assert.equal(isPeakAt(beijing(2026, 8, 22, 13, 0)), false);
	// Before peak/valley pricing existed nothing is peak.
	assert.equal(isPeakAt(beijing(2026, 8, 10, 10, 0)), false);
});

test("host: peak is exactly double the off-peak band", () => {
	// 2026-09-20 is a Sunday, inside the current flash price era.
	const offPeak = bandAt("deepseek-v4-flash", beijing(2026, 9, 20, 13, 0));
	assert.deepEqual(offPeak, { input: 1, cacheHit: 0.02, output: 4 });
	const peak = bandAt("deepseek-v4-flash", beijing(2026, 9, 21, 10, 0));
	assert.deepEqual(peak, { input: 2, cacheHit: 0.04, output: 8 });
	// Pro family is priced higher.
	assert.deepEqual(bandAt("deepseek-v4-pro", beijing(2026, 9, 20, 13, 0)), {
		input: 4.5, cacheHit: 0.15, output: 13.5
	});
	// Unknown models fall back to the flash family.
	assert.deepEqual(bandAt("some-other-model", beijing(2026, 9, 20, 13, 0)), offPeak);
});

test("host: the flash reprice at 2026-09-10 12:00 changes the band", () => {
	// 2026-09-09 13:00 Beijing: valley, before the reprice.
	const before = bandAt("deepseek-v4-flash", beijing(2026, 9, 9, 13, 0));
	// 2026-09-10 13:00 Beijing: valley, after the reprice.
	const after = bandAt("deepseek-v4-flash", beijing(2026, 9, 10, 13, 0));
	assert.deepEqual(before, { input: 1.5, cacheHit: 0.05, output: 4.5 });
	assert.deepEqual(after, { input: 1, cacheHit: 0.02, output: 4 });
});

test("host: priceUsage charges miss at input, hit at cacheHit, output at output", () => {
	const ms = beijing(2026, 9, 20, 13, 0);
	const cost = priceUsage("deepseek-v4-flash", ms, {
		cacheMiss: 1_000_000, cacheHit: 1_000_000, output: 1_000_000
	});
	assert.equal(cost, 1 + 0.02 + 4);
	const peakMs = beijing(2026, 9, 21, 10, 0);
	assert.equal(priceUsage("deepseek-v4-flash", peakMs, {
		cacheMiss: 1_000_000, cacheHit: 0, output: 0
	}), 2);
});

test("host: foldEvents buckets by Beijing day and model, skipping inherited seqs", () => {
	const byDay = new Map();
	const usageEvent = (seq, ms, model, usage) => ({
		type: "assistant/message",
		seq,
		time: ms,
		data: { message: { source: { kind: "model", provider: "deepseek-official", model } }, usage }
	});
	const events = [
		// Inherited from the parent session (seq below the boundary): ignored.
		usageEvent(0, beijing(2026, 10, 5, 10, 0), "deepseek-v4-flash", {
			inputTokens: 1, outputTokens: 1, cacheReadTokens: 1
		}),
		usageEvent(1, beijing(2026, 10, 5, 11, 0), "deepseek-v4-flash", {
			inputTokens: 1, outputTokens: 1, cacheReadTokens: 1
		}),
		usageEvent(4, beijing(2026, 10, 5, 10, 30), "deepseek-v4-flash", {
			inputTokens: 1000, outputTokens: 100, cacheReadTokens: 9000, cacheWriteTokens: 0
		}),
		usageEvent(7, beijing(2026, 10, 6, 1, 0), "deepseek-flash", {
			inputTokens: 500, outputTokens: 50, cacheReadTokens: 0
		}),
		{ type: "web/deepseek-search-llm-request", seq: 8, time: beijing(2026, 10, 6, 2, 0) }
	];
	const folded = foldEvents(byDay, events, 2);
	assert.equal(folded, 2);
	const day5 = byDay.get("2026-10-05");
	assert.equal(day5.models.get("deepseek-v4-flash").calls, 1);
	assert.equal(day5.models.get("deepseek-v4-flash").cacheHit, 9000);
	assert.equal(day5.models.get("deepseek-v4-flash").cacheMiss, 1000);
	assert.equal(day5.models.get("deepseek-v4-flash").output, 100);
	assert.ok(day5.models.get("deepseek-v4-flash").cost > 0);
	const day6 = byDay.get("2026-10-06");
	assert.equal(day6.searchCalls, 1);
	assert.equal(day6.models.get("deepseek-flash").cacheMiss, 500);
});

test("host: rangeWindow follows Beijing calendar days", () => {
	const now = beijing(2026, 10, 31, 0, 30);
	assert.deepEqual(rangeWindow("today", now), { fromDay: "2026-10-31", toDay: "2026-10-31" });
	assert.deepEqual(rangeWindow("7d", now), { fromDay: "2026-10-25", toDay: "2026-10-31" });
	assert.deepEqual(rangeWindow("30d", now), { fromDay: "2026-10-02", toDay: "2026-10-31" });
	assert.deepEqual(rangeWindow("all", now), { fromDay: null, toDay: null });
	// Unknown ranges fall back to the 7-day window.
	assert.deepEqual(rangeWindow("nonsense", now), { fromDay: "2026-10-25", toDay: "2026-10-31" });
});

/* ---------------------------------------------------------------- client  */

let definition = null;
globalThis.window = {
	__ModuleLoader__: { load: (def) => { definition = def; } },
	setInterval,
	clearInterval
};

const fakeReact = {
	createElement: (type, props, ...children) => ({ type, props, children }),
	Fragment: "Fragment",
	useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
	useEffect: () => {}
};

await import(CLIENT.href);
assert.ok(definition !== null, "client bundle should call window.__ModuleLoader__.load");

const client = definition.factory((name) => {
	if (name === "react") return fakeReact;
	throw new Error("unexpected require: " + name);
});

/** Flatten a fake element tree into its visible text. */
function text(node) {
	if (node === null || node === undefined) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join("");
	if (typeof node === "object" && Array.isArray(node.children)) return text(node.children);
	return "";
}

test("client: registers under the package id and exports its surface", () => {
	assert.equal(definition.id, "dsh-dscost-tide");
	assert.deepEqual(client.inject, ["slots"]);
	for (const name of ["apply", "TideView", "TideDashboard", "dashboardBody", "dashboardActions",
		"usageSection", "usageMetrics", "usageRows", "balanceRows", "statusOf", "phaseAt",
		"currentWindow", "nextBoundary", "countdownText", "boundaryText"]) {
		assert.equal(typeof client[name], "function", name + " should be exported");
	}
});

test("client: takes the sidebar.footer.action seat after the balance widget", () => {
	const registered = [];
	client.apply({
		get: (name) => name === "slots" ? {
			register: (config) => config,
			inject: (seat, factory) => registered.push({ seat, occupant: factory() })
		} : undefined
	});
	assert.equal(registered.length, 1);
	assert.equal(registered[0].seat, "sidebar.footer.action");
	assert.equal(registered[0].occupant.id, "dsh-dscost-tide");
	assert.equal(registered[0].occupant.order, 20);
});

test("client: peak/valley phase matches the Beijing wall clock", () => {
	assert.equal(client.phaseAt(beijing(2026, 10, 5, 10, 0)), "peak");
	assert.equal(client.phaseAt(beijing(2026, 10, 5, 13, 0)), "valley");
	assert.equal(client.phaseAt(beijing(2026, 10, 5, 15, 0)), "peak");
	assert.equal(client.phaseAt(beijing(2026, 10, 3, 10, 0)), "valley"); // Saturday
	assert.equal(client.statusOf(beijing(2026, 10, 5, 10, 0)).phase, "peak");
});

test("client: next boundary rolls Friday evening over to Monday morning", () => {
	const fridayEvening = beijing(2026, 10, 2, 19, 0);
	const next = client.nextBoundary(fridayEvening);
	assert.ok(next !== null);
	assert.equal(next.after, "peak");
	assert.equal(next.at, beijing(2026, 10, 5, 9, 0));
	assert.ok(client.nextBoundary(beijing(2026, 10, 5, 10, 0)).at > beijing(2026, 10, 5, 10, 0));
	const mondayMorning = beijing(2026, 10, 5, 10, 0);
	assert.equal(client.countdownText(beijing(2026, 10, 5, 12, 0), mondayMorning), "2 小时");
	assert.ok(client.statusOf(mondayMorning).sub.startsWith("距入谷 "));
});

test("client: number formatters keep the dashboard readable", () => {
	assert.equal(client.intText(1234567), "1,234,567");
	assert.equal(client.intText(null), "—");
	assert.equal(client.compactTokens(123_456_789), "1.23 亿");
	assert.equal(client.compactTokens(5_542_212), "554 万");
	assert.equal(client.compactTokens(9_500), "9,500");
	assert.equal(client.compactTokens(0), "0");
	assert.equal(client.percentText(0.90182), "90.18%");
	assert.equal(client.percentText(undefined), "—");
	assert.equal(client.costText(1.266574), "¥1.27");
	assert.equal(client.costText(0.05), "¥0.0500");
	assert.equal(client.costText(undefined), "—");
});

const usagePayload = {
	ok: true,
	range: "today",
	timezone: "Asia/Shanghai",
	fromDay: "2026-10-31",
	toDay: "2026-10-31",
	totals: {
		calls: 63, promptTokens: 5486221, cacheHitTokens: 4947584, cacheMissTokens: 538637,
		outputTokens: 55991, reasoningTokens: 0, totalTokens: 5542212, hitRate: 0.90182,
		cost: 0.861553, searchCalls: 0, searchCost: 0, requests: 63, totalCost: 0.861553
	},
	byDay: [{
		day: "2026-10-31", calls: 63, promptTokens: 5486221, cacheHitTokens: 4947584,
		cacheMissTokens: 538637, outputTokens: 55991, reasoningTokens: 0, totalTokens: 5542212,
		hitRate: 0.90182, cost: 0.861553, searchCalls: 0, searchCost: 0, requests: 63, totalCost: 0.861553
	}],
	byModel: [{ model: "deepseek-flash", calls: 63, totalTokens: 5542212, hitRate: 0.90182, totalCost: 0.861553 }]
};

test("client: usageMetrics shows tokens, hit rate, cost and request count", () => {
	const metrics = client.usageMetrics(usagePayload);
	assert.equal(metrics.length, 4);
	const shown = metrics.map((node) => text(node));
	assert.ok(shown[0].includes("消耗 token"));
	assert.ok(shown[0].includes("554 万"));
	assert.ok(shown[1].includes("缓存命中率"));
	assert.ok(shown[1].includes("90.18%"));
	assert.ok(shown[2].includes("消耗金额"));
	assert.ok(shown[2].includes("¥0.86"));
	assert.ok(shown[3].includes("API 请求次数"));
	assert.ok(shown[3].includes("63"));
});

test("client: usageRows reports the token split and the covered window", () => {
	const rows = client.usageRows(usagePayload).map((node) => text(node));
	assert.ok(rows.some((line) => line.includes("提示词") && line.includes("5,486,221")));
	assert.ok(rows.some((line) => line.includes("输出") && line.includes("55,991")));
	assert.ok(rows.some((line) => line.includes("模型调用") && line.includes("63 次")));
	assert.ok(rows.some((line) => line.includes("统计天数") && line.includes("1 天")));
	assert.ok(rows.some((line) => line.includes("统计区间") && line.includes("2026-10-31 至 2026-10-31")));
});

test("client: usageSection renders the time-dimension switch and four tiles", () => {
	const picked = [];
	const section = client.usageSection({
		range: "today",
		setRange: (id) => picked.push(id),
		status: "ready",
		data: usagePayload,
		stale: false,
		error: null,
		refresh: () => {}
	});
	const body = text(section);
	for (const label of ["今天", "近 7 天", "近 30 天", "全部"]) assert.ok(body.includes(label), label);
	assert.ok(body.includes("消耗 token"));
	assert.ok(body.includes("90.18%"));

	// The switch is wired: pressing "7d" asks for that dimension.
	const head = section.children.flat()[0];
	const group = head.children.flat().find((node) => node !== null && typeof node === "object" && node.props?.className === "dspk_seg");
	const buttons = group.children.flat();
	assert.equal(buttons.length, 4);
	buttons[1].props.onClick();
	assert.deepEqual(picked, ["7d"]);
});

test("client: usageSection explains loading and failure states", () => {
	const loading = text(client.usageSection({
		range: "7d", setRange: () => {}, status: "loading", data: null, stale: true, error: null, refresh: () => {}
	}));
	assert.ok(loading.includes("正在汇总会话日志"));
	const failed = text(client.usageSection({
		range: "7d", setRange: () => {}, status: "error", data: null, stale: false, error: "HTTP 500", refresh: () => {}
	}));
	assert.ok(failed.includes("统计获取失败"));
	assert.ok(failed.includes("HTTP 500"));
});

