/**
 * dsh-dscost-tide — browser half.
 *
 * Sits in the sidebar footer, next to the provider's own bottom-left entries,
 * and answers three questions at a glance:
 *   · is DeepSeek billing at peak (red) or valley (green) right now, Beijing time;
 *   · what the account wallet holds, and how long until the tier flips;
 *   · what the Beijing wall clock says right now.
 *
 * The card is two rows and spans the full sidebar width: the head row carries
 * the phase dot, the phase name and the wallet; the foot row carries the
 * countdown to the next tier flip and the live clock.
 *
 * Clicking the card opens a detail dashboard — the arrangement follows the
 * plugin market's dsh-ui-usage-billing (compact sidebar metrics + modal). The
 * dashboard repeats the live tier state, draws the day's 24-hour peak/valley
 * strip and lists the wallet breakdown plus usage/top-up links.
 *
 * The phase math is local (no network, ticks every second). The wallet comes
 * from this plugin's Host half over <BALANCE_URL> — the browser side has no
 * account service of its own — and is re-polled once a minute.
 *
 * Hand-written __ModuleLoader__ bundle (no build step), same shape as the
 * shipped dsh-client-ui-* bundles: registering only stores the factory; the
 * body runs at materialization in the browser page.
 */
window.__ModuleLoader__.load({
	id: "dsh-dscost-tide",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");

		//#region optional shell primitives
		/**
		 * The shell ships a `Modal` primitive (portal + mask + card + Escape +
		 * aria) and the plugin market's billing dashboard renders its dashboard
		 * with it, so the detail view inherits the product's own dialog chrome.
		 * It is resolved through the client module graph; when it is missing the
		 * dashboard falls back to a self-rendered overlay so the card can never
		 * be taken down by a missing peer.
		 */
		let modalPrimitive = null;
		try {
			const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
			if (primitives !== null && primitives !== undefined && typeof primitives.Modal === "function") {
				modalPrimitive = primitives.Modal;
			}
		} catch {
			modalPrimitive = null;
		}
		//#endregion

		//#region css
		const css = [
			".dspk_card{box-sizing:border-box;margin:6px 0 2px;flex:1 1 auto;width:100%;min-width:0;border-radius:8px;padding:6px 10px 7px;display:flex;flex-direction:column;gap:1px;overflow:hidden;transition:background-color .35s ease,box-shadow .35s ease}",
			".dspk_card.is-peak{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 20%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}",
			".dspk_card.is-valley{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}",
			".dspk_card.is-clickable{cursor:pointer}",
			".dspk_card.is-clickable:hover{outline:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);outline-offset:-1px}",
			".dspk_card.is-clickable:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".dspk_head{display:flex;align-items:center;gap:6px;min-width:0}",
			".dspk_dot{box-sizing:border-box;width:8px;height:8px;border-radius:50%;flex:none}",
			".dspk_card.is-peak .dspk_dot{background:var(--dsw-alias-state-error-primary)}",
			".dspk_card.is-valley .dspk_dot{background:var(--dsw-alias-state-success-primary)}",
			".dspk_phase{color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dspk_bal{margin-left:auto;flex:none;color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".dspk_bal.is-muted{color:var(--dsw-alias-label-secondary);font-weight:400;font-size:11px}",
			".dspk_foot{display:flex;align-items:baseline;gap:6px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px;white-space:nowrap;font-variant-numeric:tabular-nums;overflow:hidden}",
			".dspk_foottext{overflow:hidden;text-overflow:ellipsis}",
			".dspk_at{margin-left:auto;flex:none}",
			".dspk_rail{box-sizing:border-box;width:36px;height:36px;margin:0 auto;flex:none;border-radius:50%;align-items:center;justify-content:center;display:flex;cursor:pointer}",
			".dspk_rail.is-peak{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent)}",
			".dspk_rail.is-valley{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,transparent)}",
			".dspk_rail:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dspk_rail .dspk_dot{width:10px;height:10px}",
			".dspk_body{display:flex;flex-direction:column;gap:14px;min-width:0}",
			".dspk_hero{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}",
			".dspk_pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:12px;line-height:18px;font-weight:600}",
			".dspk_pill.is-peak{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}",
			".dspk_pill.is-valley{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}",
			".dspk_pill.is-peak .dspk_dot{background:var(--dsw-alias-state-error-primary)}",
			".dspk_pill.is-valley .dspk_dot{background:var(--dsw-alias-state-success-primary)}",
			".dspk_heroDate{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".dspk_heroClock{margin-left:auto;color:var(--dsw-alias-label-primary);font-size:20px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums}",
			".dspk_section{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px 11px;display:flex;flex-direction:column;gap:5px;min-width:0}",
			".dspk_sectionTitle{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:600;letter-spacing:.04em}",
			".dspk_row{display:flex;align-items:baseline;gap:12px;font-size:12px;line-height:18px;min-width:0}",
			".dspk_rowKey{flex:none;color:var(--dsw-alias-label-secondary)}",
			".dspk_rowVal{margin-left:auto;text-align:right;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;word-break:break-word}",
			".dspk_rowVal.is-muted{color:var(--dsw-alias-label-secondary)}",
			".dspk_stripWrap{display:flex;flex-direction:column;gap:3px;margin-top:3px}",
			".dspk_strip{display:flex;gap:2px}",
			".dspk_cell{flex:1 1 0;min-width:0;height:18px;border-radius:3px}",
			".dspk_cell.is-peak{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}",
			".dspk_cell.is-valley{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)}",
			".dspk_cell.is-now{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dspk_stripAxis{display:flex;justify-content:space-between;color:var(--dsw-alias-label-secondary);font-size:9px;line-height:12px;font-variant-numeric:tabular-nums}",
			".dspk_btn{box-sizing:border-box;appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:16px;padding:4px 10px;cursor:pointer;text-decoration:none}",
			".dspk_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dspk_dialogWide.dspk_dialogWide{width:min(440px,100%)}",
			".dspk_dock.dspk_dock{align-self:flex-end;margin:0 auto 0 0}",
			".dspk_overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:flex-start;padding:0 0 12px 8px}",
			".dspk_mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}",
			".dspk_dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:14px;width:min(440px,100%);max-height:calc(100vh - 96px);overflow:auto;padding:18px 20px 20px;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}",
			".dspk_dialogHead{display:flex;align-items:center;justify-content:space-between;gap:8px}",
			".dspk_dialogTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:16px;line-height:24px;font-weight:500}",
			".dspk_close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;line-height:16px}",
			".dspk_close:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dspk_dialogFoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}",
			".dspk_rangeRow{display:flex;align-items:center;gap:8px;min-width:0}",
			".dspk_seg{margin-left:auto;flex:none;display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}",
			".dspk_segBtn{box-sizing:border-box;appearance:none;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11px;line-height:16px;padding:3px 8px;cursor:pointer;white-space:nowrap}",
			".dspk_segBtn:hover{color:var(--dsw-alias-label-primary)}",
			".dspk_segBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
			".dspk_segBtn.is-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}",
			".dspk_metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}",
			".dspk_metric{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;display:flex;flex-direction:column;gap:1px;min-width:0}",
			".dspk_metricKey{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dspk_metricVal{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dspk_metricVal.is-muted{color:var(--dsw-alias-label-secondary);font-weight:400}",
			".dspk_tip{position:fixed;z-index:1001;box-sizing:border-box;width:236px;display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);pointer-events:none}",
			".dspk_tipTitle{display:flex;align-items:baseline;gap:6px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px;font-weight:600;letter-spacing:.04em}",
			".dspk_tipAt{margin-left:auto;font-weight:400;font-variant-numeric:tabular-nums}",
			".dspk_tipRow{display:flex;align-items:baseline;gap:8px;font-size:11px;line-height:16px;min-width:0}",
			".dspk_tipKey{flex:none;color:var(--dsw-alias-label-secondary)}",
			".dspk_tipVal{margin-left:auto;text-align:right;color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dspk_tipVal.is-muted{color:var(--dsw-alias-label-secondary);font-weight:400}"
		].join("\n");
		const tagId = "dsh-dscost-tide/Tide.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region clock helpers
		/** Beijing wall clock (UTC+8, no DST). */
		const BJ_OFFSET_MS = 8 * 3600 * 1000;
		const DAY_MS = 86400000;
		/** Official DeepSeek peak windows, minutes-of-day Beijing (since 2026-08-17). */
		const PEAK_WINDOWS = [[540, 720], [840, 1080]];
		const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
		function pad(n) { return n < 10 ? "0" + n : String(n); }
		function fmtMin(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
		function bjParts(ms) {
			const d = new Date(ms + BJ_OFFSET_MS);
			const hh = pad(d.getUTCHours());
			const mm = pad(d.getUTCMinutes());
			return {
				dow: d.getUTCDay(), // 0 Sun .. 6 Sat in Beijing
				min: d.getUTCHours() * 60 + d.getUTCMinutes(),
				sec: d.getUTCSeconds(),
				hhmm: hh + ":" + mm,
				hhmmss: hh + ":" + mm + ":" + pad(d.getUTCSeconds())
			};
		}
		/** Official tiers: Mon–Fri 09:00–12:00 and 14:00–18:00 peak; weekends all-valley since 2026-08-23. */
		function phaseAt(ms) {
			const p = bjParts(ms);
			if (p.dow === 0 || p.dow === 6) return "valley";
			for (const w of PEAK_WINDOWS) if (p.min >= w[0] && p.min < w[1]) return "peak";
			return "valley";
		}
		/** The peak window containing `ms`, or null outside peak. */
		function currentWindow(ms) {
			const p = bjParts(ms);
			if (p.dow === 0 || p.dow === 6) return null;
			for (const w of PEAK_WINDOWS) if (p.min >= w[0] && p.min < w[1]) return { start: w[0], end: w[1] };
			return null;
		}
		/** Next tier boundary at or after `nowMs`, skipping weekend days (all-valley). */
		function nextBoundary(nowMs) {
			const start = bjParts(nowMs);
			const shifted = nowMs + BJ_OFFSET_MS;
			const utcMidnight = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - BJ_OFFSET_MS;
			const boundaries = [PEAK_WINDOWS[0][0], PEAK_WINDOWS[0][1], PEAK_WINDOWS[1][0], PEAK_WINDOWS[1][1]];
			for (let d = 0; d <= 8; d++) {
				const dow = (start.dow + d) % 7;
				if (dow === 0 || dow === 6) continue;
				for (let i = 0; i < boundaries.length; i++) {
					const at = utcMidnight + d * DAY_MS + boundaries[i] * 60000;
					if (at > nowMs) return { at, after: phaseAt(at) };
				}
			}
			return null;
		}
		function countdownText(at, nowMs) {
			const totalSec = Math.max(0, Math.round((at - nowMs) / 1000));
			if (totalSec < 60) return totalSec + " 秒";
			const totalMin = Math.floor(totalSec / 60);
			if (totalMin < 10) {
				const sec = totalSec % 60;
				return totalMin + " 分" + (sec > 0 ? " " + sec + " 秒" : "");
			}
			if (totalMin < 60) return totalMin + " 分钟";
			const hours = Math.floor(totalMin / 60);
			const mins = totalMin % 60;
			if (hours < 24) return hours + " 小时" + (mins > 0 ? " " + mins + " 分" : "");
			return Math.floor(hours / 24) + " 天 " + (hours % 24) + " 小时";
		}
		function phaseLabel(phase) { return phase === "peak" ? "高峰期" : "低谷期"; }
		function statusOf(nowMs) {
			const phase = phaseAt(nowMs);
			const next = nextBoundary(nowMs);
			const sub = next === null ? "" : "距" + (next.after === "peak" ? "入峰" : "入谷") + " " + countdownText(next.at, nowMs);
			const tip = phase === "peak"
				? "DeepSeek 高峰时段（周一至周五 09:00–12:00、14:00–18:00，北京时间）"
				: "DeepSeek 低谷时段（其余时间；周末全天低谷价）";
			return { phase, label: phaseLabel(phase), sub, tip };
		}
		/** Beijing calendar day of `ms`, as a comparable integer. */
		function beijingDayKey(ms) {
			const d = new Date(ms + BJ_OFFSET_MS);
			return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
		}
		function dateText(ms) {
			const d = new Date(ms + BJ_OFFSET_MS);
			return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
		}
		/** "今天 14:00" / "明天 09:00" / "周一 09:00" for a tier boundary. */
		function boundaryText(next, nowMs) {
			if (next === null) return "—";
			const delta = beijingDayKey(next.at) - beijingDayKey(nowMs);
			const day = delta === 0 ? "今天" : delta === 1 ? "明天" : WEEKDAY_NAMES[bjParts(next.at).dow];
			return day + " " + fmtMin(bjParts(next.at).min);
		}
		//#endregion

		//#region balance
		/** Route published by this plugin's Host half. */
		const BALANCE_URL = "/dsh-dscost-tide/api/balance";
		const BALANCE_POLL_MS = 60000;
		function useBalance() {
			const [state, setState] = react.useState({ status: "loading", balance: null, error: null, fetchedAt: null, links: null });
			const [reload, setReload] = react.useState(0);
			react.useEffect(() => {
				let alive = true;
				const controller = new AbortController();
				const load = async () => {
					try {
						const response = await fetch(BALANCE_URL, { headers: { accept: "application/json" }, signal: controller.signal });
						if (!response.ok) throw new Error("HTTP " + response.status);
						const payload = await response.json();
						if (!alive) return;
						const balance = payload !== null && typeof payload === "object" ? payload.balance : null;
						const ready = balance !== null && balance.status === "ready";
						setState({
							status: ready ? "ready" : "unavailable",
							balance,
							error: null,
							fetchedAt: payload !== null && typeof payload === "object" && typeof payload.fetchedAt === "number" ? payload.fetchedAt : Date.now(),
							links: payload !== null && typeof payload === "object" ? payload.links ?? null : null
						});
					} catch (error) {
						if (!alive || error.name === "AbortError") return;
						setState({ status: "error", balance: null, error: String(error.message ?? error), fetchedAt: null, links: null });
					}
				};
				load();
				const id = window.setInterval(load, BALANCE_POLL_MS);
				return () => {
					alive = false;
					controller.abort();
					window.clearInterval(id);
				};
			}, [reload]);
			return {
				status: state.status,
				balance: state.balance,
				error: state.error,
				fetchedAt: state.fetchedAt,
				links: state.links,
				refresh: () => { setReload((value) => value + 1); }
			};
		}
		function currencySign(currency) { return currency === "USD" ? "$" : "¥"; }
		function money(value) { return typeof value === "number" ? value.toFixed(2) : "—"; }
		/** Text + tone for the wallet slot. */
		function balanceText(state) {
			if (state.status === "ready") return { text: currencySign(state.balance.currency) + money(state.balance.total), muted: false };
			if (state.status === "loading") return { text: "余额 …", muted: true };
			if (state.status === "unavailable") return { text: "余额不可用", muted: true };
			return { text: "余额获取失败", muted: true };
		}
		/** Long-form wallet line used in the tooltip. */
		function balanceDetail(state) {
			if (state.status === "ready") {
				const b = state.balance;
				const parts = [currencySign(b.currency) + money(b.total)];
				if (typeof b.granted === "number" && b.granted > 0) parts.push("含赠送 " + currencySign(b.currency) + money(b.granted));
				parts.push(b.source === "api-key" ? "来源：API Key" : "来源：账号");
				return parts.join(" · ");
			}
			if (state.status === "loading") return "余额查询中…";
			const reason = state.balance !== null && typeof state.balance === "object" && typeof state.balance.reason === "string" ? state.balance.reason : state.error;
			if (state.status === "unavailable") return "余额不可用（未登录或凭据失效）" + (reason ? "\n" + reason : "");
			return "余额获取失败" + (reason ? "\n" + reason : "");
		}
		function sourceText(source) {
			if (source === "api-key") return "API Key";
			if (source === "account") return "账号平台";
			return "—";
		}
		//#endregion

		//#region usage
		/** Route published by this plugin's Host half for folded session-log usage. */
		const USAGE_URL = "/dsh-dscost-tide/api/usage";
		/** Log folding touches the disk on the Host, so a slow poll is plenty. */
		const USAGE_POLL_MS = 180000;
		/** Time dimensions offered here; the ids mirror the Host's `range` values. */
		const USAGE_RANGES = [
			{ id: "today", label: "今天" },
			{ id: "7d", label: "近 7 天" },
			{ id: "30d", label: "近 30 天" },
			{ id: "all", label: "全部" }
		];
		function intText(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			return Math.round(value).toLocaleString("en-US");
		}
		/** Chinese magnitudes keep eight-digit token counts readable in a metric tile. */
		function compactTokens(value) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "0";
			if (value >= 1e8) return (value / 1e8).toFixed(2) + " 亿";
			if (value >= 1e4) return (value / 1e4).toFixed(value >= 1e6 ? 0 : 1) + " 万";
			return intText(value);
		}
		function percentText(rate) {
			if (typeof rate !== "number" || !Number.isFinite(rate)) return "—";
			return (rate * 100).toFixed(2) + "%";
		}
		/** Early in a day the spend is sub-cent, so keep four decimals below ¥1. */
		function costText(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			return "¥" + (Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(4));
		}
		/** Folded usage for the selected dimension; fetched only while the dashboard is open. */
		function useUsage(active) {
			const [range, setRange] = react.useState("today");
			const [state, setState] = react.useState({ status: "loading", data: null, error: null, forRange: null });
			const [reload, setReload] = react.useState(0);
			react.useEffect(() => {
				if (!active) return undefined;
				let alive = true;
				const controller = new AbortController();
				const load = async () => {
					try {
						const response = await fetch(USAGE_URL + "?range=" + encodeURIComponent(range), { headers: { accept: "application/json" }, signal: controller.signal });
						if (!response.ok) throw new Error("HTTP " + response.status);
						const payload = await response.json();
						if (!alive) return;
						const ok = payload !== null && typeof payload === "object" && payload.ok === true && payload.totals !== null && typeof payload.totals === "object";
						setState({ status: ok ? "ready" : "error", data: ok ? payload : null, error: ok ? null : "unexpected payload", forRange: range });
					} catch (error) {
						if (!alive || error.name === "AbortError") return;
						setState({ status: "error", data: null, error: String(error.message ?? error), forRange: range });
					}
				};
				load();
				const id = window.setInterval(load, USAGE_POLL_MS);
				return () => {
					alive = false;
					controller.abort();
					window.clearInterval(id);
				};
			}, [active, range, reload]);
			return {
				range,
				setRange,
				status: state.status,
				data: state.data,
				error: state.error,
				// A range switch keeps the previous numbers in state; hide them until they match.
				stale: state.forRange !== range,
				refresh: () => { setReload((value) => value + 1); }
			};
		}
		function metric(key, label, value) {
			return react.createElement("div", { className: "dspk_metric", key }, [
				react.createElement("span", { className: "dspk_metricKey", key: "label" }, label),
				react.createElement("span", { className: "dspk_metricVal", key: "value" }, value)
			]);
		}
		/** The four headline numbers for the selected dimension. */
		function usageMetrics(data) {
			const t = data.totals;
			return [
				metric("tokens", "消耗 token", compactTokens(t.totalTokens)),
				metric("hit", "缓存命中率", percentText(t.hitRate)),
				metric("cost", "消耗金额", costText(t.totalCost)),
				metric("calls", "API 请求次数", intText(t.requests))
			];
		}
		function usageRows(data) {
			const t = data.totals;
			const days = Array.isArray(data.byDay) ? data.byDay : [];
			const daily = days.length > 0 ? t.totalCost / days.length : 0;
			return [
				row("提示词", intText(t.promptTokens) + "（命中 " + intText(t.cacheHitTokens) + " · 未命中 " + intText(t.cacheMissTokens) + "）"),
				row("输出", intText(t.outputTokens) + (t.reasoningTokens > 0 ? "（含思考 " + intText(t.reasoningTokens) + "）" : "")),
				row("模型调用", intText(t.calls) + " 次 · " + costText(t.cost)),
				row("联网搜索", intText(t.searchCalls) + " 次 · " + costText(t.searchCost)),
				row("统计天数", days.length + " 天 · 日均 " + costText(daily), { muted: true }),
				row("统计区间", data.fromDay === null || data.fromDay === undefined ? "全部历史" : data.fromDay + " 至 " + data.toDay, { muted: true })
			];
		}
		/** Usage section carrying its own time-dimension switch. */
		function usageSection(usage) {
			const head = react.createElement("div", { className: "dspk_rangeRow", key: "head" }, [
				react.createElement("span", { className: "dspk_sectionTitle", key: "title" }, "用量统计"),
				react.createElement("div", { className: "dspk_seg", key: "seg", role: "group", "aria-label": "时间维度" },
					USAGE_RANGES.map((item) => react.createElement("button", {
						key: item.id,
						type: "button",
						className: "dspk_segBtn" + (item.id === usage.range ? " is-on" : ""),
						"aria-pressed": item.id === usage.range,
						onClick: () => usage.setRange(item.id)
					}, item.label)))
			]);
			const children = [head];
			if (usage.status === "ready" && usage.data !== null && usage.stale !== true) {
				children.push(react.createElement("div", { className: "dspk_metrics", key: "metrics" }, usageMetrics(usage.data)));
				for (const line of usageRows(usage.data)) children.push(line);
			} else if (usage.status === "error" && usage.stale !== true) {
				children.push(row("状态", "统计获取失败", { muted: true }));
				children.push(row("原因", String(usage.error ?? "—"), { muted: true }));
			} else {
				children.push(row("状态", "正在汇总会话日志…", { muted: true }));
			}
			return react.createElement("div", { className: "dspk_section", key: "usage" }, children);
		}
		//#endregion

		//#region detail dashboard
		/** Public DeepSeek platform page, used when the Host publishes no links. */
		const DEFAULT_LINKS = { topUpUrl: "https://platform.deepseek.com/top_up" };
		/** One key/value line inside a dashboard section. */
		function row(key, text, options) {
			const opts = options ?? {};
			return react.createElement("div", { className: "dspk_row", key }, [
				react.createElement("span", { className: "dspk_rowKey", key: "key" }, key),
				react.createElement("span", { className: "dspk_rowVal" + (opts.muted ? " is-muted" : ""), key: "value" }, text)
			]);
		}
		/** A titled section, optionally followed by an extra block (the day strip). */
		function section(key, title, rows, extra) {
			const children = [react.createElement("div", { className: "dspk_sectionTitle", key: "title" }, title)].concat(rows);
			if (extra !== undefined && extra !== null) children.push(extra);
			return react.createElement("div", { className: "dspk_section", key }, children);
		}
		/** 24 hourly cells for the current Beijing day (mid-hour sample per cell). */
		function dayCells(nowMs) {
			const p = bjParts(nowMs);
			const dayStart = nowMs - p.min * 60000 - p.sec * 1000 - (nowMs % 1000);
			const currentHour = Math.floor(p.min / 60);
			const cells = [];
			for (let hour = 0; hour < 24; hour++) {
				const phase = phaseAt(dayStart + (hour * 60 + 30) * 60000);
				cells.push(react.createElement("span", {
					key: "h" + hour,
					className: "dspk_cell is-" + phase + (hour === currentHour ? " is-now" : ""),
					title: pad(hour) + ":00 " + (phase === "peak" ? "高峰" : "低谷")
				}));
			}
			return cells;
		}
		function dayStrip(nowMs) {
			return react.createElement("div", { className: "dspk_stripWrap", key: "strip" }, [
				react.createElement("div", { className: "dspk_strip", key: "cells" }, dayCells(nowMs)),
				react.createElement("div", { className: "dspk_stripAxis", key: "axis" }, [
					react.createElement("span", { key: "a0" }, "00:00"),
					react.createElement("span", { key: "a6" }, "06:00"),
					react.createElement("span", { key: "a12" }, "12:00"),
					react.createElement("span", { key: "a18" }, "18:00"),
					react.createElement("span", { key: "a24" }, "24:00")
				])
			]);
		}
		function pricingRows(nowMs) {
			const s = statusOf(nowMs);
			const next = nextBoundary(nowMs);
			return [
				row("倒计时", s.sub.length > 0 ? s.sub : "—"),
				row("下次切换", next === null ? "—" : boundaryText(next, nowMs) + "（" + (next.after === "peak" ? "入峰" : "入谷") + "）")
			];
		}
		function balanceRows(balance) {
			if (balance.status === "loading") return [row("总余额", "查询中…", { muted: true })];
			const b = balance.balance;
			if (balance.status === "ready" && b !== null && typeof b === "object") {
				const sign = currencySign(b.currency);
				const rows = [row("总余额", sign + money(b.total))];
				if (typeof b.toppedUp === "number") rows.push(row("充值余额", sign + money(b.toppedUp)));
				if (typeof b.granted === "number") rows.push(row("赠送余额", sign + money(b.granted)));
				if (Array.isArray(b.wallets) && b.wallets.length > 1) {
					rows.push(row("其他币种", b.wallets
						.filter((wallet) => wallet.currency !== b.currency)
						.map((wallet) => currencySign(wallet.currency) + money(wallet.balance))
						.join(" · ")));
				}
				rows.push(row("数据来源", sourceText(b.source)));
				if (typeof balance.fetchedAt === "number") rows.push(row("更新时间", bjParts(balance.fetchedAt).hhmmss, { muted: true }));
				return rows;
			}
			const rows = [row("状态", balance.status === "error" ? "获取失败" : "不可用", { muted: true })];
			const reason = b !== null && typeof b === "object" && typeof b.reason === "string" ? b.reason : balance.error;
			if (typeof reason === "string" && reason.length > 0) rows.push(row("原因", reason, { muted: true }));
			rows.push(row("提示", "登录 DeepSeek 账号或配置 DEEPSEEK_API_KEY 后重试", { muted: true }));
			return rows;
		}
		function dashboardBody(nowMs, balance, usage) {
			const s = statusOf(nowMs);
			const tone = s.phase === "peak" ? "is-peak" : "is-valley";
			const p = bjParts(nowMs);
			const hero = react.createElement("div", { className: "dspk_hero", key: "hero" }, [
				react.createElement("span", { className: "dspk_pill " + tone, key: "pill" }, [
					react.createElement("span", { className: "dspk_dot", "aria-hidden": true, key: "dot" }),
					s.label
				]),
				react.createElement("span", { className: "dspk_heroDate", key: "date" }, dateText(nowMs) + " " + WEEKDAY_NAMES[p.dow]),
				react.createElement("span", { className: "dspk_heroClock", key: "clock" }, p.hhmmss)
			]);
			return [
				hero,
				section("pricing", "计费时段", pricingRows(nowMs), dayStrip(nowMs)),
				section("balance", "账户余额", balanceRows(balance)),
				usageSection(usage)
			];
		}
		function dashboardActions(balance, usage) {
			const topUp = balance.links !== null && balance.links !== undefined && typeof balance.links === "object" && typeof balance.links.topUpUrl === "string"
				? balance.links.topUpUrl
				: DEFAULT_LINKS.topUpUrl;
			return [
				react.createElement("a", { className: "dspk_btn", key: "topup", href: topUp, target: "_blank", rel: "noreferrer noopener" }, "充值"),
				react.createElement("button", {
					className: "dspk_btn",
					key: "refresh",
					type: "button",
					onClick: () => { balance.refresh(); usage.refresh(); }
				}, "刷新")
			];
		}
		/** Detail dashboard for one moment; rendered with the shell Modal, or a local overlay. */
		function TideDashboard(props) {
			const nowMs = props.now;
			const balance = props.balance;
			const usage = props.usage;
			const onClose = props.onClose;
			react.useEffect(() => {
				if (modalPrimitive !== null) return undefined;
				const onKey = (event) => { if (event.key === "Escape") onClose(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			const body = dashboardBody(nowMs, balance, usage);
			const actions = dashboardActions(balance, usage);
			const title = "DeepSeek 时段 · 余额 · 用量";
			if (modalPrimitive !== null) {
				return react.createElement(modalPrimitive, {
					open: true,
					onClose,
					title,
					closeLabel: "关闭",
					className: "dspk_dialogWide dspk_dock",
					contentClassName: "dspk_body",
					footer: actions
				}, body);
			}
			return react.createElement("div", { className: "dspk_overlay", role: "presentation" }, [
				react.createElement("div", { className: "dspk_mask", "aria-hidden": true, key: "mask", onClick: onClose }),
				react.createElement("div", { className: "dspk_dialog", role: "dialog", "aria-modal": "true", "aria-label": title, key: "dialog" }, [
					react.createElement("div", { className: "dspk_dialogHead", key: "head" }, [
						react.createElement("h2", { className: "dspk_dialogTitle", key: "title" }, title),
						react.createElement("button", { className: "dspk_close", type: "button", "aria-label": "关闭", onClick: onClose, key: "close" }, "×")
					]),
					react.createElement("div", { className: "dspk_body", key: "body" }, body),
					react.createElement("div", { className: "dspk_dialogFoot", key: "foot" }, actions)
				])
			]);
		}
		//#endregion

		//#region view
		/**
		 * Small floating read-out of today's spend, anchored above the card while the
		 * pointer or focus rests on it. Kept out of the clickable card on purpose: it
		 * must never become part of the card's click target or its overflow box.
		 */
		function usagePreview(usage, anchor) {
			const t = usage.status === "ready" && usage.data !== null ? usage.data.totals : null;
			const rowEl = (key, label, value, muted) => react.createElement("div", { className: "dspk_tipRow", key }, [
				react.createElement("span", { className: "dspk_tipKey", key: "key" }, label),
				react.createElement("span", { className: "dspk_tipVal" + (muted === true ? " is-muted" : ""), key: "val" }, value)
			]);
			const rows = t === null
				? [rowEl("state", "今日", usage.status === "error" ? "统计不可用" : "正在汇总…", true)]
				: [
					rowEl("tokens", "消耗 token", compactTokens(t.totalTokens)),
					rowEl("hit", "缓存命中率", percentText(t.hitRate)),
					rowEl("cost", "消耗金额", costText(t.totalCost))
				];
			return react.createElement("div", {
				className: "dspk_tip",
				role: "tooltip",
				style: { left: anchor.left + "px", bottom: anchor.bottom + "px" }
			}, [
				react.createElement("div", { className: "dspk_tipTitle", key: "title" }, [
					react.createElement("span", { key: "label" }, "今日用量"),
					react.createElement("span", { className: "dspk_tipAt", key: "at" }, bjParts(anchor.now).hhmmss)
				]),
				...rows
			]);
		}
		function TideView(props) {
			const wide = props.wide !== false;
			const [now, setNow] = react.useState(Date.now);
			const [open, setOpen] = react.useState(false);
			// Anchor of the hover read-out: null when hidden, else viewport coordinates.
			const [tip, setTip] = react.useState(null);
			// Sticky, so the preview fetches once on first hover and then polls quietly.
			const [warm, setWarm] = react.useState(false);
			const balance = useBalance();
			const usage = useUsage(open);
			const preview = useUsage(warm);
			react.useEffect(() => {
				const id = window.setInterval(() => setNow(Date.now()), 1000);
				return () => window.clearInterval(id);
			}, []);
			const s = statusOf(now);
			const detail = balanceDetail(balance);
			const tone = s.phase === "peak" ? "is-peak" : "is-valley";
			const toggle = () => setOpen((value) => !value);
			const showTip = (event) => {
				const target = event === null || event === undefined ? null : event.currentTarget;
				if (target === null || typeof target.getBoundingClientRect !== "function") return;
				const rect = target.getBoundingClientRect();
				setWarm(true);
				setTip({ left: Math.max(8, Math.round(rect.left)), bottom: Math.max(8, Math.round(window.innerHeight - rect.top + 6)), now: Date.now() });
			};
			const hideTip = () => setTip(null);
			const onKeyDown = (event) => {
				if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
					if (typeof event.preventDefault === "function") event.preventDefault();
					toggle();
				}
			};
			const dashboard = open ? react.createElement(TideDashboard, { now, balance, usage, onClose: () => setOpen(false) }) : null;
			const tipNode = tip === null || open ? null : usagePreview(preview, tip);
			if (!wide) {
				const rail = react.createElement("div", {
					className: "dspk_rail " + tone,
					role: "button",
					tabIndex: 0,
					"aria-expanded": open,
					"aria-label": s.label + " · " + detail + "，点击查看详情",
					onClick: toggle,
					onKeyDown,
					onMouseEnter: showTip,
					onMouseLeave: hideTip,
					onFocus: showTip,
					onBlur: hideTip
				}, react.createElement("span", { className: "dspk_dot", "aria-hidden": true }));
				return tipNode === null && dashboard === null ? rail : react.createElement(react.Fragment, null, tipNode, rail, dashboard);
			}
			const wallet = balanceText(balance);
			const clock = bjParts(now).hhmmss;
			// The dashboard is a sibling of the card, never a child: clicks inside the
			// dialog must not reach the card's open handler through the React tree, and
			// the card's own `overflow:hidden` must not clip the overlay.
			const card = react.createElement("div", {
				className: "dspk_card " + tone + " is-clickable",
				role: "button",
				tabIndex: 0,
				"aria-expanded": open,
				"aria-label": s.label + " · " + detail + "，点击查看详情",
				onClick: toggle,
				onKeyDown,
				onMouseEnter: showTip,
				onMouseLeave: hideTip,
				onFocus: showTip,
				onBlur: hideTip
			}, [
				react.createElement("div", { className: "dspk_head", key: "head" }, [
					react.createElement("span", { className: "dspk_dot", "aria-hidden": true, key: "dot" }),
					react.createElement("span", { className: "dspk_phase", key: "phase" }, s.label),
					react.createElement("span", { className: "dspk_bal" + (wallet.muted ? " is-muted" : ""), key: "bal" }, wallet.text)
				]),
				react.createElement("div", { className: "dspk_foot", key: "foot" }, [
					react.createElement("span", { className: "dspk_foottext", key: "text" }, s.sub.length > 0 ? s.sub : s.label),
					react.createElement("span", { className: "dspk_at", key: "at" }, clock)
				])
			]);
			return tipNode === null && dashboard === null ? card : react.createElement(react.Fragment, null, tipNode, card, dashboard);
		}
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots"];

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("sidebar.footer.action", () => slots.register({
				name: "sidebar.footer.action",
				id: "dsh-dscost-tide",
				order: 20,
				label: () => statusOf(Date.now()).label
			}, TideView));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.TideView = TideView;
		exports.TideDashboard = TideDashboard;
		exports.dashboardBody = dashboardBody;
		exports.dashboardActions = dashboardActions;
		exports.usageSection = usageSection;
		exports.usagePreview = usagePreview;
		exports.usageMetrics = usageMetrics;
		exports.usageRows = usageRows;
		exports.compactTokens = compactTokens;
		exports.costText = costText;
		exports.percentText = percentText;
		exports.intText = intText;
		exports.USAGE_RANGES = USAGE_RANGES;
		exports.balanceRows = balanceRows;
		exports.statusOf = statusOf;
		exports.phaseAt = phaseAt;
		exports.currentWindow = currentWindow;
		exports.nextBoundary = nextBoundary;
		exports.countdownText = countdownText;
		exports.boundaryText = boundaryText;
		return module.exports;
	}
});
