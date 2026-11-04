/**
 * dsh-dscost-tide — Host half.
 *
 * Two jobs, both published on one loopback route prefix:
 *
 *   1. Balance. The browser half can compute the peak/valley phase on its own
 *      (pure Beijing wall-clock math, no network), but it cannot read the
 *      account wallet: the web client has no account service at all. Sources,
 *      in order:
 *        a. `deepseekAccount.getBalance(client)` — the Platform grant stored by
 *           the Host (null when signed out or when the grant no longer answers).
 *        b. the `DEEPSEEK_API_KEY` credential against
 *           api.deepseek.com/user/balance.
 *      The payload keeps the platform's own split (topped-up wallet vs
 *      granted/bonus wallet) so the dashboard can show where the money came
 *      from, plus the account's usage/top-up links.
 *
 *   2. Usage. Token cost is not stored anywhere queryable — session logs are
 *      the only record — so this half folds them through the Host's own
 *      `sessionPersistence` seam (`list()` → `open(id, 'read')` →
 *      `handle.read(0)`), skips each log's fork-inherited prefix
 *      (`handle.inheritedEventCount`), prices every `assistant/message` usage
 *      record at the model/peak/valley rate in force at that event's own
 *      timestamp, and answers per range (today / 7d / 30d / all). Folded
 *      sessions are memoised by the persistence revision, so a refresh only
 *      re-reads the logs that changed.
 *
 * Delivery: `GET <ROUTE_PREFIX>/balance` and `GET <ROUTE_PREFIX>/usage?range=…`
 * on the loopback web server. Web-server routes carry no authentication of
 * their own, so the handler re-checks the request exactly the way the built-in
 * /api gateway does (Host-header authority must be loopback/trusted, cross-site
 * browser requests refused, Origin must match Host).
 */

/** Route prefix owned by this plugin — deliberately outside the built-in /api gateway. */
const ROUTE_PREFIX = "/dsh-dscost-tide/api";
/** Identity reported to Platform with every balance query. */
const CLIENT_VERSION = "1.1.2";
const CLIENT_LOCALE = "zh-CN";
/** Fallback source, used only when the stored account grant cannot answer. */
const API_KEY_REF = "DEEPSEEK_API_KEY";
const API_KEY_BALANCE_URL = "https://api.deepseek.com/user/balance";

export const inject = ["webServer", "sessionPersistence"];

//#region helpers

/** Service lookup that works whether or not the name was declared in `inject`. */
function serviceOf(ctx, name) {
	try {
		if (typeof ctx.get === "function") {
			const found = ctx.get(name);
			if (found !== undefined && found !== null) return found;
		}
	} catch {}
	return ctx[name];
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

function toNumber(value) {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

function pickWallet(wallets) {
	if (!Array.isArray(wallets) || wallets.length === 0) return null;
	const cny = wallets.find((w) => w !== null && typeof w === "object" && w.currency === "CNY");
	return cny ?? wallets[0] ?? null;
}

function sumWallets(wallets) {
	if (!Array.isArray(wallets) || wallets.length === 0) return null;
	let total = 0;
	let seen = false;
	for (const w of wallets) {
		const n = w !== null && typeof w === "object" ? toNumber(w.balance) : null;
		if (n !== null) {
			total += n;
			seen = true;
		}
	}
	return seen ? total : null;
}

/** Wallet rows echoed to the browser (one currency each, in Platform order). */
function walletList(wallets) {
	if (!Array.isArray(wallets)) return [];
	const rows = [];
	for (const w of wallets) {
		if (w === null || typeof w !== "object") continue;
		const balance = toNumber(w.balance);
		if (balance === null) continue;
		rows.push({ currency: typeof w.currency === "string" ? w.currency : "CNY", balance });
	}
	return rows;
}

//#endregion

//#region usage accounting — Beijing wall clock

/** Beijing has no DST: a fixed +08:00 offset is exact. */
const BJ_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;
/** Peak windows as minutes from Beijing midnight: 09:00–12:00 and 14:00–18:00. */
const PEAK_WINDOWS = [[540, 720], [840, 1080]];
/** Pricing eras, in epoch ms (see README "峰谷与计价"). */
const PEAK_ERA_START_MS = Date.parse("2026-08-16T16:00:00Z");
const WEEKEND_OFFPEAK_START_MS = Date.parse("2026-08-22T16:00:00Z");
const FLASH_REPRICE_MS = Date.parse("2026-09-10T04:00:00Z");
/** Flat estimate for one auxiliary web-search LLM request (CNY). */
const SEARCH_CALL_CNY = 0.02;
/**
 * Off-peak bands in CNY per 1M tokens; peak is exactly double.
 * `earlier` is the band in force before `earlierUntil`.
 */
const MODEL_CATALOG = [
	{
		family: "flash",
		match: /flash/i,
		offPeak: { input: 1, cacheHit: 0.02, output: 4 },
		earlier: { input: 1.5, cacheHit: 0.05, output: 4.5 },
		earlierUntil: FLASH_REPRICE_MS
	},
	{ family: "pro", match: /pro/i, offPeak: { input: 4.5, cacheHit: 0.15, output: 13.5 } }
];
const DEFAULT_FAMILY = MODEL_CATALOG[0];

/** Beijing day key ("YYYY-MM-DD") for an epoch-ms instant. */
function bjDayKey(ms) {
	return new Date(ms + BJ_OFFSET_MS).toISOString().slice(0, 10);
}

function bjClock(ms) {
	const shifted = new Date(ms + BJ_OFFSET_MS);
	return { dow: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/** True when `ms` falls in an officially peak-priced window. */
function isPeakAt(ms) {
	if (ms < PEAK_ERA_START_MS) return false;
	const { dow, minutes } = bjClock(ms);
	const weekend = dow === 0 || dow === 6;
	if (weekend && ms >= WEEKEND_OFFPEAK_START_MS) return false;
	for (const [from, to] of PEAK_WINDOWS) if (minutes >= from && minutes < to) return true;
	return false;
}

function familyOf(model) {
	const name = typeof model === "string" ? model : "";
	for (const entry of MODEL_CATALOG) if (entry.match.test(name)) return entry;
	return DEFAULT_FAMILY;
}

/** The three rates in force for `model` at instant `ms`. */
function bandAt(model, ms) {
	const family = familyOf(model);
	const base = family.earlier !== undefined && ms < family.earlierUntil ? family.earlier : family.offPeak;
	if (!isPeakAt(ms)) return base;
	return { input: base.input * 2, cacheHit: base.cacheHit * 2, output: base.output * 2 };
}

/** Cost in CNY of one usage record, priced at the event's own timestamp. */
function priceUsage(model, ms, usage) {
	const band = bandAt(model, ms);
	return (usage.cacheMiss * band.input + usage.cacheHit * band.cacheHit + usage.output * band.output) / 1e6;
}

function newBucket() {
	return { calls: 0, cacheHit: 0, cacheMiss: 0, output: 0, reasoning: 0, cost: 0 };
}

function addBucket(target, source) {
	target.calls += source.calls;
	target.cacheHit += source.cacheHit;
	target.cacheMiss += source.cacheMiss;
	target.output += source.output;
	target.reasoning += source.reasoning;
	target.cost += source.cost;
}

function newDay() {
	return { models: new Map(), searchCalls: 0 };
}

function dayOf(map, key) {
	let day = map.get(key);
	if (day === undefined) {
		day = newDay();
		map.set(key, day);
	}
	return day;
}

/** Model name of an assistant message's source block. */
function modelNameOf(source) {
	if (source === null || typeof source !== "object") return "unknown";
	if (typeof source.model === "string" && source.model.length > 0) return source.model;
	if (typeof source.provider === "string" && source.provider.length > 0) return source.provider;
	return "unknown";
}

/**
 * Fold one session log into per-day, per-model buckets.
 * Events below `inheritedCount` are the fork-inherited parent prefix: they were
 * already counted in the parent session's own log.
 */
function foldEvents(byDay, events, inheritedCount) {
	let folded = 0;
	for (const event of events) {
		if (event === null || typeof event !== "object") continue;
		const seq = toNumber(event.seq);
		if (seq !== null && seq < inheritedCount) continue;
		const time = toNumber(event.time) ?? Date.now();
		if (event.type === "assistant/message") {
			const data = event.data;
			const usage = data !== null && typeof data === "object" ? data.usage : undefined;
			if (usage === null || typeof usage !== "object") continue;
			const message = data.message !== null && typeof data.message === "object" ? data.message : undefined;
			const model = modelNameOf(message !== undefined ? message.source : undefined);
			const hit = toNumber(usage.cacheReadTokens) ?? 0;
			const written = toNumber(usage.cacheWriteTokens) ?? 0;
			const miss = (toNumber(usage.inputTokens) ?? 0) + written;
			const output = toNumber(usage.outputTokens) ?? 0;
			const day = dayOf(byDay, bjDayKey(time));
			let bucket = day.models.get(model);
			if (bucket === undefined) {
				bucket = newBucket();
				day.models.set(model, bucket);
			}
			bucket.calls += 1;
			bucket.cacheHit += hit;
			bucket.cacheMiss += miss;
			bucket.output += output;
			bucket.reasoning += toNumber(usage.reasoningTokens) ?? 0;
			bucket.cost += priceUsage(model, time, { cacheHit: hit, cacheMiss: miss, output });
			folded += 1;
		} else if (event.type === "web/deepseek-search-llm-request") {
			const day = dayOf(byDay, bjDayKey(time));
			day.searchCalls += 1;
		}
	}
	return folded;
}

/** Day window covered by a range selector. */
function rangeWindow(range, nowMs) {
	const today = bjDayKey(nowMs);
	if (range === "today") return { fromDay: today, toDay: today };
	if (range === "30d") return { fromDay: bjDayKey(nowMs - 29 * DAY_MS), toDay: today };
	if (range === "all") return { fromDay: null, toDay: null };
	return { fromDay: bjDayKey(nowMs - 6 * DAY_MS), toDay: today };
}

const RANGES = ["today", "7d", "30d", "all"];

/** Pure accounting helpers, exported for the offline test harness. */
export { bjDayKey, isPeakAt, bandAt, priceUsage, foldEvents, rangeWindow, bucketOut, RANGES };

function round(value, digits) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function bucketOut(bucket) {
	const prompt = bucket.cacheHit + bucket.cacheMiss;
	return {
		calls: bucket.calls,
		promptTokens: prompt,
		cacheHitTokens: bucket.cacheHit,
		cacheMissTokens: bucket.cacheMiss,
		outputTokens: bucket.output,
		reasoningTokens: bucket.reasoning,
		totalTokens: prompt + bucket.output,
		hitRate: prompt > 0 ? round(bucket.cacheHit / prompt, 6) : null,
		cost: round(bucket.cost, 6)
	};
}

async function closeHandle(handle) {
	try {
		if (handle === null || typeof handle !== "object") return;
		if (typeof handle.close === "function") {
			await handle.close();
			return;
		}
		const dispose = handle[Symbol.asyncDispose];
		if (typeof dispose === "function") await dispose.call(handle);
	} catch {}
}

/**
 * Per-session fold cache plus the range aggregation. Sessions are memoised by
 * the persistence revision + physical size, so an unchanged log is never
 * re-read; the aggregated payload itself is reused for a short window to keep a
 * polling dashboard from re-scanning the list on every tick.
 */
function createUsageAggregator(ctx) {
	/** @type {Map<string, {stamp: string, byDay: Map<string, {models: Map<string, object>, searchCalls: number}>, events: number}>} */
	const cache = new Map();
	let lastBody = null;
	let lastAt = 0;
	let lastRange = null;
	const RESULT_TTL_MS = 3000;

	function stampOf(row) {
		return String(row?.revision ?? "") + "|" + String(row?.sizeBytes ?? "");
	}

	async function foldSession(persistence, row) {
		const header = row !== null && typeof row === "object" ? row.header : undefined;
		const id = header !== null && typeof header === "object" && typeof header.id === "string" ? header.id : undefined;
		if (id === undefined) return { cached: true };
		const stamp = stampOf(row);
		const previous = cache.get(id);
		if (previous !== undefined && previous.stamp === stamp) return { cached: true };
		const handle = await persistence.open(id, "read");
		try {
			const slice = await handle.read(0);
			const events = Array.isArray(slice)
				? slice
				: slice !== null && typeof slice === "object" && Array.isArray(slice.events)
					? slice.events
					: [];
			const inherited = toNumber(handle.inheritedEventCount) ?? 0;
			const byDay = new Map();
			foldEvents(byDay, events, inherited);
			cache.set(id, { stamp, byDay, events: events.length });
			return { cached: false };
		} finally {
			await closeHandle(handle);
		}
	}

	async function aggregate(range, force) {
		const persistence = serviceOf(ctx, "sessionPersistence");
		if (persistence === null || persistence === undefined || typeof persistence.list !== "function") {
			return { ok: false, error: { code: "no-persistence", message: "session persistence is unavailable" } };
		}
		const now = Date.now();
		const window = rangeWindow(range, now);
		if (!force && lastBody !== null && lastRange === range && now - lastAt < RESULT_TTL_MS) return lastBody;

		const rows = await persistence.list();
		const list = Array.isArray(rows) ? rows : [];
		const seen = new Set();
		const errors = [];
		let foldedNow = 0;
		for (const row of list) {
			const id = row?.header?.id;
			if (typeof id !== "string") continue;
			seen.add(id);
			try {
				const folded = await foldSession(persistence, row);
				if (folded.cached === false) foldedNow += 1;
			} catch (error) {
				errors.push({ id, message: errorText(error) });
			}
			// Yield so a long cold fold never blocks the Host's request loop.
			await new Promise((resolve) => setImmediate(resolve));
		}
		for (const id of [...cache.keys()]) if (!seen.has(id)) cache.delete(id);

		const total = newBucket();
		let searchCalls = 0;
		const byDay = new Map();
		const byModel = new Map();
		const inWindow = (day) =>
			(window.fromDay === null || day >= window.fromDay) && (window.toDay === null || day <= window.toDay);
		for (const entry of cache.values()) {
			for (const [dayKey, day] of entry.byDay) {
				if (!inWindow(dayKey)) continue;
				const target = dayOf(byDay, dayKey);
				target.searchCalls += day.searchCalls;
				searchCalls += day.searchCalls;
				for (const [model, bucket] of day.models) {
					let dayBucket = target.models.get(model);
					if (dayBucket === undefined) {
						dayBucket = newBucket();
						target.models.set(model, dayBucket);
					}
					addBucket(dayBucket, bucket);
					let modelBucket = byModel.get(model);
					if (modelBucket === undefined) {
						modelBucket = newBucket();
						byModel.set(model, modelBucket);
					}
					addBucket(modelBucket, bucket);
					addBucket(total, bucket);
				}
			}
		}

		const totals = {
			...bucketOut(total),
			searchCalls,
			searchCost: round(searchCalls * SEARCH_CALL_CNY, 6),
			requests: total.calls + searchCalls,
			totalCost: round(total.cost + searchCalls * SEARCH_CALL_CNY, 6)
		};
		const days = [...byDay.entries()]
			.filter(([, day]) => day.models.size > 0 || day.searchCalls > 0)
			.sort((a, b) => (a[0] < b[0] ? -1 : 1))
			.map(([day, entry]) => {
				const bucket = newBucket();
				for (const value of entry.models.values()) addBucket(bucket, value);
				const searchCost = entry.searchCalls * SEARCH_CALL_CNY;
				return {
					day,
					...bucketOut(bucket),
					searchCalls: entry.searchCalls,
					searchCost: round(searchCost, 6),
					requests: bucket.calls + entry.searchCalls,
					totalCost: round(bucket.cost + searchCost, 6)
				};
			});
		const models = [...byModel.entries()]
			.map(([model, bucket]) => ({ model, ...bucketOut(bucket), totalCost: round(bucket.cost, 6) }))
			.sort((a, b) => b.cost - a.cost || b.calls - a.calls);

		const body = {
			ok: true,
			fetchedAt: now,
			range,
			timezone: "Asia/Shanghai",
			fromDay: window.fromDay,
			toDay: window.toDay,
			totals,
			byDay: days,
			byModel: models,
			sessions: { listed: list.length, cached: cache.size, folded: foldedNow, errors }
		};
		lastBody = body;
		lastAt = now;
		lastRange = range;
		return body;
	}

	return { aggregate, cache };
}

//#endregion

//#region balance sources

function clientMetadata() {
	return {
		version: CLIENT_VERSION,
		locale: CLIENT_LOCALE,
		timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
	};
}

/**
 * Primary source: the Platform account grant held by the Host.
 * Returns null when the service is absent, the user is signed out, the grant
 * changed, or the query failed — the caller then falls back to the API key.
 */
async function accountBalance(ctx) {
	const account = serviceOf(ctx, "deepseekAccount");
	if (account === undefined || account === null || typeof account.getBalance !== "function") return null;
	const details = await account.getBalance(clientMetadata());
	if (details === null || details === undefined) return null;
	if (details.status !== "ready") return null;
	const main = pickWallet(details.value);
	if (main === null) return null;
	// Platform semantics: total = topped-up wallet + granted (bonus) wallet.
	const toppedUp = sumWallets(details.value);
	const granted = sumWallets(details.bonusWallets);
	const total = toNumber(main.balance);
	return {
		status: "ready",
		source: "account",
		currency: typeof main.currency === "string" ? main.currency : "CNY",
		total: toppedUp !== null && granted !== null ? toppedUp + granted : total,
		toppedUp,
		granted,
		bonus: granted,
		wallets: walletList(details.value),
		bonusWallets: walletList(details.bonusWallets),
		reason: null
	};
}

/** Fallback: the stored API key against the public balance endpoint. */
async function apiKeyBalance(ctx, reason) {
	const unavailable = (why) => ({
		status: "unavailable",
		source: null,
		currency: "CNY",
		total: null,
		toppedUp: null,
		granted: null,
		bonus: null,
		wallets: [],
		bonusWallets: [],
		reason: why
	});
	try {
		const credentials = serviceOf(ctx, "credentials");
		if (credentials === null || credentials === undefined || typeof credentials.resolve !== "function") return unavailable(reason);
		const resolved = await credentials.resolve(API_KEY_REF);
		const key = typeof resolved === "string"
			? resolved
			: resolved !== null && typeof resolved === "object"
				? resolved.value ?? resolved.secret ?? resolved.token
				: undefined;
		if (typeof key !== "string" || key.length === 0) return unavailable(reason);
		const response = await fetch(API_KEY_BALANCE_URL, {
			headers: { authorization: "Bearer " + key, accept: "application/json" },
			signal: AbortSignal.timeout(8000)
		});
		if (!response.ok) return unavailable(reason + " / http-" + response.status);
		const payload = await response.json();
		const infos = payload !== null && typeof payload === "object" && Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
		const wallet = pickWallet(infos);
		if (wallet === null) return unavailable(reason + " / no-wallet");
		const granted = toNumber(wallet.granted_balance);
		const toppedUp = toNumber(wallet.topped_up_balance);
		const total = toNumber(wallet.total_balance);
		return {
			status: "ready",
			source: "api-key",
			currency: typeof wallet.currency === "string" ? wallet.currency : "CNY",
			total: total !== null ? total : (granted !== null && toppedUp !== null ? granted + toppedUp : null),
			toppedUp,
			granted,
			bonus: granted,
			wallets: infos
				.filter((info) => info !== null && typeof info === "object")
				.map((info) => ({ currency: typeof info.currency === "string" ? info.currency : "CNY", balance: toNumber(info.total_balance) }))
				.filter((row) => row.balance !== null),
			bonusWallets: [],
			available: payload !== null && typeof payload === "object" ? payload.is_available === true : null,
			reason: null
		};
	} catch (error) {
		return unavailable(reason + " / " + errorText(error));
	}
}

async function resolveBalance(ctx) {
	try {
		const primary = await accountBalance(ctx);
		if (primary !== null) return primary;
		return await apiKeyBalance(ctx, "account-grant-unavailable");
	} catch (error) {
		return await apiKeyBalance(ctx, "account-error: " + errorText(error));
	}
}

/**
 * Usage / top-up links published by the account controller. Absent when the
 * user is signed out or the controller keeps no links; the browser side then
 * falls back to the public platform URLs.
 */
async function accountLinks(ctx) {
	try {
		const account = serviceOf(ctx, "deepseekAccount");
		if (account === null || account === undefined || typeof account.getState !== "function") return null;
		const state = await account.getState();
		const links = state !== null && typeof state === "object" ? state.links : undefined;
		if (links === null || typeof links !== "object") return null;
		const usageUrl = typeof links.usageUrl === "string" ? links.usageUrl : null;
		const topUpUrl = typeof links.topUpUrl === "string" ? links.topUpUrl : null;
		if (usageUrl === null && topUpUrl === null) return null;
		return { usageUrl, topUpUrl };
	} catch {
		return null;
	}
}

//#endregion

//#region transport

function sendJson(res, status, body) {
	if (res.writableEnded === true) return;
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(text),
		"cache-control": "no-store"
	});
	res.end(text);
}

function headerValue(req, name) {
	const headers = req !== null && typeof req === "object" ? req.headers : undefined;
	if (headers === null || headers === undefined) return undefined;
	const value = headers[name];
	if (typeof value === "string") return value;
	return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
}

function isLoopbackHostname(hostname) {
	const name = hostname.toLowerCase();
	if (name === "localhost" || name === "[::1]" || name === "::1") return true;
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

function trustedHostsOf(ctx) {
	try {
		const runtime = serviceOf(ctx, "webRuntime");
		const hosts = runtime !== null && runtime !== undefined ? runtime.trustedHosts : undefined;
		return Array.isArray(hosts) ? hosts : [];
	} catch {
		return [];
	}
}

function isTrustedAuthority(hostUrl, trustedHosts) {
	for (const entry of trustedHosts) {
		try {
			const trusted = new URL(typeof entry === "string" ? entry : String(entry));
			if (trusted.hostname === hostUrl.hostname && trusted.port === hostUrl.port) return true;
		} catch {}
	}
	return false;
}

/** Same fence the built-in /api gateway uses: loopback authority, same-origin, not cross-site. */
function isTrustedRequest(req, ctx) {
	const host = headerValue(req, "host");
	if (host === undefined || host.length === 0) return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHostsOf(ctx))) return false;
	if (headerValue(req, "sec-fetch-site") === "cross-site") return false;
	const origin = headerValue(req, "origin");
	if (origin === undefined || origin === "null") return true;
	try {
		return new URL(origin).hostname === hostUrl.hostname;
	} catch {
		return false;
	}
}

//#endregion

export function apply(ctx) {
	const webServer = ctx.webServer ?? serviceOf(ctx, "webServer");
	if (webServer === undefined || webServer === null || typeof webServer.register !== "function") return;

	const usage = createUsageAggregator(ctx);

	const handler = async (req, res) => {
		if (!isTrustedRequest(req, ctx)) {
			sendJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
			return;
		}
		if (req.method !== "GET") {
			sendJson(res, 405, { ok: false, error: { code: "method", message: "GET only" } });
			return;
		}
		let url = null;
		try {
			url = new URL(req.url ?? "/", "http://dsh.internal");
		} catch {}
		const pathname = url !== null ? url.pathname : "/";
		if (pathname === ROUTE_PREFIX + "/usage" || pathname === ROUTE_PREFIX + "/usage/") {
			const raw = url !== null ? url.searchParams.get("range") : null;
			const range = RANGES.includes(raw) ? raw : "7d";
			const force = url !== null && url.searchParams.get("refresh") === "1";
			try {
				sendJson(res, 200, await usage.aggregate(range, force));
			} catch (error) {
				sendJson(res, 200, { ok: false, error: { code: "usage-failed", message: errorText(error) } });
			}
			return;
		}
		if (pathname !== ROUTE_PREFIX && pathname !== ROUTE_PREFIX + "/balance" && pathname !== ROUTE_PREFIX + "/") {
			sendJson(res, 404, { ok: false, error: { code: "not-found", message: pathname } });
			return;
		}
		const balance = await resolveBalance(ctx);
		const links = await accountLinks(ctx);
		sendJson(res, 200, { ok: true, fetchedAt: Date.now(), links, balance });
	};

	ctx.effect(() => webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }), "dsh-dscost-tide: " + ROUTE_PREFIX);
}
