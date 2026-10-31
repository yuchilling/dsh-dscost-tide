# dsh-dscost-tide

> 在 DeepSeek Harness 侧边栏底部看一眼就知道：**现在是高峰还是低谷、账户还有多少钱、这些钱花在哪些 token 上。**

一个 DSH 组合包（Cordis 插件）插件，占用侧边栏底部的 `sidebar.footer.action` 座位，排在官方余额插件之后。

## 长什么样

侧边栏底部是一张两行卡片，高峰染红、低谷染绿：

```
● 高峰期   距入谷 2 小时 30 分
¥余额                      14:32
```

点一下卡片弹出详情（四个区）：

```
现在 高峰期
高峰按时段价，低谷五折              ← Hero 胶囊

计费时段
倒计时        距入谷 2 小时 30 分
下次切换      今天 12:00（入谷）
[ 24 格峰谷条：凌晨 / 上午 / 午后 / 晚间 ]

账户余额
总额          ¥数字
充值钱包      ¥数字
赠送钱包      ¥数字

用量统计                [今天][近 7 天][近 30 天][全部]
消耗 token    1,069 万        缓存命中率   95.57%
消耗金额      ¥1.27           API 请求次数  137
提示词        10,550,026（命中 10,082,816 · 未命中 467,210）
输出          149,427
模型调用      137 次 · ¥1.2666
联网搜索      0 次 · ¥0.0000
统计天数      6 天 · 日均 ¥0.2111
统计区间      2026-10-05 至 2026-10-05
```

## 功能

- **峰谷一眼可见**：按官方峰谷时段（北京时间工作日 09:00–12:00、14:00–18:00 为高峰，其余为低谷；2026-08-23 起周末全天低谷）给卡片染色，并显示距下次切换的倒计时。
- **账户余额**：优先读取 Host 已授权的 DeepSeek 账户余额（充值钱包 + 赠送钱包），读不到时回退到 `DEEPSEEK_API_KEY` 查询 `api.deepseek.com/user/balance`。
- **用量统计（按时间维度）**：`今天` / `近 7 天` / `近 30 天` / `全部` 四档，给出消耗 token、缓存命中率、消耗金额、API 请求次数，以及提示词命中/未命中、输出、模型调用、联网搜索、日均与统计区间。
- **真实计价**：token 不估算，逐个 `assistant/message` 事件按**它自己的时间戳**套用当时生效的峰谷价（含 2026-09-10 12:00 的 Flash 调价），联网搜索按 ¥0.02/次计。
- **不打扰**：只在弹窗打开时拉取用量；折叠结果按会话日志版本号缓存，刷新只重读变化的日志。

## 安装

### 方式一：作为组合包安装（推荐）

发布到 npm 之后，在 DSH 的 **插件** 页直接安装并启用：

```bash
npm install -g dsh   # 已有 DSH 可跳过
dsh plugin add dsh-dscost-tide
```

或在「插件 → 已安装」里打开本插件。装好后**完全退出并重启 DeepSeek Harness**（客户端 bundle 在启动时预载，热更新拿不到新的 UI 代码）。

### 方式二：从本地源码 `link:` 安装

适合改代码调试。编辑 `~/.dsh/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "dsh-dscost-tide": "link:E:/path/to/dsh-dscost-tide"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-dscost-tide"]
    }
  }
}
```

然后在 profile 目录执行一次 `pnpm install`，再完全重启 DSH。源码改动同样需要重启才能生效。

### 卸载

在插件页关闭或移除即可；手动安装的话，删掉 `dependencies` 与 `dsh.profile.bundles` 里的条目，重启。

## 计费口径

| 模型族 | 低谷 · 输入 | 低谷 · 缓存命中 | 低谷 · 输出 | 高峰 |
| --- | ---: | ---: | ---: | ---: |
| Flash（`deepseek-v4-flash` / `deepseek-flash`） | ¥1 / 1M | ¥0.02 / 1M | ¥4 / 1M | ×2 |
| Flash（2026-09-10 12:00 之前） | ¥1.5 / 1M | ¥0.05 / 1M | ¥4.5 / 1M | ×2 |
| Pro（`deepseek-v4-pro`） | ¥4.5 / 1M | ¥0.15 / 1M | ¥13.5 / 1M | ×2 |

- 高峰窗口：北京时间 **工作日 09:00–12:00、14:00–18:00**；低谷 = 其余时间（2026-08-23 起含周末全天）。
- 峰谷价自 **2026-08-17** 起生效；更早的会话按低谷价计。
- 一次调用的花费 = `未命中 token × 输入价 + 命中 token × 缓存价 + 输出 token × 输出价`；联网搜索另计 ¥0.02/次。
- 金额单位 CNY。价格随官方调整而变化，若与账单有出入，以 [DeepSeek 官方定价](https://api-docs.deepseek.com/quick_start/pricing) 为准。

## 数据来源与隐私

- **峰谷**：纯本地时钟计算，不联网。
- **余额**：Host 侧账户授权（或你配置的 `DEEPSEEK_API_KEY`）向 DeepSeek 查询，只走本机回环路由 `/dsh-dscost-tide/api/balance`。
- **用量**：只读本机 `~/.dsh/sessions/**` 会话日志，不读取、不外发任何消息内容；fork/子代理会话按 `inheritedEventCount` 跳过继承的父前缀，避免重复计数。
- 两条路由都只服务本机回环请求：校验 `Host` 必须是回环或受信主机，拒绝跨站请求与不匹配的 `Origin`。

## 兼容性

- 需要 DeepSeek Harness **0.2.x**（`engines.dsh: >=0.2.0-rc.1 <0.3.0-0`），在 `0.2.1-rc.5`（Windows 桌面端）上验证。
- 浏览器端需要 `@deepseek-ai/dsh-client-ui-primitives`（存在时使用其 `Modal`，缺失时自动回退到自带遮罩层）。
- Node.js ≥ 22（仅开发/测试需要）。

## 开发

```bash
node --test test/plugin.test.mjs  # 纯函数级离线测试，不需要 DSH 运行时
node scripts/check-publish.mjs     # 发布前自检（清单字段 / 文件 / 占位符）
node scripts/prepare-publish.mjs   # 生成可发布副本并打包，打印 tarball 内容
```

`prepare-publish` 会把可发布的文件复制到 `_intermediate/publish/`，并改写仓库地址。本地工作树里的 `name` 保持 `dsh-dscost-tide` 不动（它是 profile `dependencies` / `dsh.profile.bundles` 里的安装键），npm 上的包名也沿用同一个，发布前跑一次：

```bash
node scripts/prepare-publish.mjs --repo yuchilling/dsh-dscost-tide
cd _intermediate/publish && npm publish --access public
```

> npm 会先在建包时写一个 `0.0.0-stage` 占位版本再上传正式版本，这是 npm 对 bypass-2FA token 的新策略，属正常现象。发布只需要一次 `npm publish`，无需再批准。

## 许可

[MIT](./LICENSE)
