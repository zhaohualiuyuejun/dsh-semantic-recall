# dsh-semantic-recall · 会话语义检索

> **换新对话，不再等于从头再来。**
> 插件在后台把最近 N 天（默认 7）的对话建成语义索引——跨工作区、存在本机；
> 你只要描述个大概（「前几天说的那个…」），就能把当时聊过的话题和原话找回来。
> 找不准的时候它会**反问**你，而不是硬编一个答案。

一个 DSH（DeepSeek Harness）插件：只读会话历史、本地建索引、4 个 agent 工具 + **自带设置页**。

> ⚠️ 名字说明：npm 上已有的 `dsh-session-recall` 是**另一个人**的同类插件（确定性/字面式检索），
> 与本插件无关。本插件的包名是 **`dsh-semantic-recall`**。

---

## 它解决什么（以及不解决什么）

| | 管什么 | 什么时候有用 |
|---|---|---|
| **上下文压缩** | 当前这场对话太长时，把历史压成摘要 | 一场对话里不爆窗 |
| **本插件** | 换了一场对话之后，过去那些还在不在 | 开新对话、跨工作区找旧话题 |

**两者互补**：压缩保当前，检索保历史。所以准确的说法是「**开新对话不再等于从头再来**」，
而不是「解决上下文压缩」。

**不要过度承诺**：

- 只在**索引窗口内**（默认 7 天，可调；超出窗口的不在索引里）
- 需要**嵌入能力**才叫语义检索；没有就只做字面匹配，**只能给候选**
- 增量是「启动 + 每 6 小时」，刚聊完想立刻搜，点设置页的「增量更新」
- 被排除的工作区不索引
- 召回是「**相对准确 + 不确定就反问**」，不保证 100%——宁可给候选，不装懂

## 它做什么

| 能力 | 说明 |
|---|---|
| **会话语义检索** | 向量余弦 + BM25 字面，RRF 融合；返回「那场对话」而不是孤零零一句 |
| **对话式反问**（差异点） | 最高相关度 < 0.55 时不装懂：返回 `fallback_menu`（按天话题卡 + 最近会话），由 agent 在对话里反问 |
| **日摘要 / 话题卡**（差异点） | 每天 3~5 个话题；**默认用 DSH 自己的模型**总结，也可指定本机 Ollama（完全不出网） |
| **自然语言时间锚点**（差异点） | 今天 / 昨天 / 前天 / 上周 / 本周 / N 天前 / N 号 / 前几天 |

## 工具

| 工具 | 用途 |
|---|---|
| `session_recall` | 核心检索。参数：`query` / `days` / `role` / `max_sessions` / `include_active` |
| `session_recall_status` | 索引多少块、建于何时、是否在建、嵌入来源是否就绪、话题卡几天 |
| `session_recall_reindex` | 手动重建（`force=true` 全量重嵌） |
| `session_recall_config` | 读/改设置（非密钥项） |

## 设置页（普通用户用这个，不用碰 JSON）

装好后：**设置 → 会话语义检索**（左侧导航里的一项）。**普通用户只需要这一页，不用碰任何 JSON。**

- 看状态：索引块数 / 维度 / 体积 / 建于何时 / 话题卡几天 / 是否正在建（带进度条）
- **检索方式**：云端 / 本地 两个按钮。云端填 API Key + 接口地址 + 模型；本地填服务地址 + 嵌入模型
- 标题行右侧有 **「停用嵌入」**（旁边写明：会导致检索能力下降）
- **索引天数**；**工作区勾选列表**（✅ 索引 / □ 不索引；新出现的工作区默认勾上）
- 自动增量开关、每日话题卡开关与总结模型（留空 = 用 DSH 当前模型）
- 「增量更新」「全量重建」两个按钮（**全量重建通常需要数分钟，属于正常现象**：要把 2000~3000 块逐条嵌入）

> 为什么不用 DSH 自带的插件设置页：本机 0.2.1-rc.5 的 `settings.update()` **返回成功但不落盘**
> （社区里 0.1.7 起就有这个「能读不能写」的问题）。所以这一页直接调插件自己的
> `/api/session-recall/*`（本机同源校验），写 `$DSH_HOME/session-recall/config.json`——
> **不依赖那个坏掉的写入路径，任何版本都能用**。

## 版本兼容

| 项 | 声明 |
|---|---|
| `engines.node` | `>=22`（依赖 Node 内置的 `zlib.zstdDecompressSync`） |
| `engines.dsh` | `>=0.2.1-rc.5`（本插件只在该版本实测通过） |
| 会话格式 | 依赖 `session.v4.jsonl.zstd`；**DSH 大版本换格式时要改 `lib/extract.mjs`** |
| 设置写入 | 不依赖 `ctx.settings.update()`（该路径在 rc.5 不落盘）；走自己的 `config.json` |
| 失败姿态 | 嵌入不可用 → 自动降级字面检索；Ollama 不可用 → 跳过话题卡；都不影响工具可用 |

## 判定规则（2026-10-31 标定，15 条查询）

只靠余弦分**分不开**真命中与假命中（实测：真命中 0.578~0.826，假命中 0.475~0.616，区间重叠）。
gap（top1−top2）和 z 分数也分不开。最终采用**双条件 + 一道闸门**：

```
found = 非自我引用 && (
           top1 ≥ 0.70                                  // 高分线：实测真命中都在这之上
        || (top1 ≥ 0.55 && 词面证据覆盖 ≥ 50% 或 英文词命中)   // 中等：必须有字面词对上
        )
```

- **自我引用闸门**：top 块是 AI 说的话、且把问题核心串**原样复述**了一遍 ⇒ 它在「讨论这句话」而不是「回答这句话」。
  （实测：MVP 调试那场把测试问句写进了语料，「去哪吃饭」因此拿到 0.576 高分 —— 这是最伤信任的假阳性。）
- 标定结果：15 条查询 **12 对 / 1 漏 / 0 假阳性**。漏的那条是「C盘满了怎么清理」（换了说法问、词面没对上），
  按「宁可给候选，不装懂」给候选菜单。
- 纯字面模式（`none`）另用一条更严的规则：只认 df ≤ 5 的稀有实词命中，否则一律给候选。

## 数据与隐私

- **只读** `~/.dsh/sessions/<工作区>/<会话>/session.v4.jsonl.zstd`；**绝不写回** sessions 目录。
- 索引写在 `$DSH_HOME/session-recall/`（`index/meta.json` + `index/vectors.f32`）。
- 只存「人话」：跳过 reasoning、工具调用/结果、系统注入、自动化会话的人设提示。
- 云端嵌入时，只把**切好的文本块**发给 API；不出网的话把 `provider` 设成 `local` 或 `none`。
- `excludeWorkspaces`：逗号分隔的目录名子串，命中就不索引（例如 `dsh-bili-duty,scratch-notes`）。

## 设置（两种方式）

### 方式一：设置页（推荐）

见上面「设置页」一节，普通用户只用这一种。

### 方式二：直接改配置文件（没有页面时 / 高级用法）

配置页背后的存储就是它：

```
$DSH_HOME/session-recall/config.json      # Windows: C:\Users\<你>\.dsh\session-recall\config.json
```

```json
{
  "provider": "cloud",
  "apiKey": "sk-...",
  "apiBase": "",
  "localBase": "",
  "model": "",
  "indexDays": 7,
  "daySummaries": true,
  "summaryModel": "",
  "autoIndex": true,
  "excludeWorkspaces": "dsh-bili-duty,scratch-notes"
}
```

- `summaryModel` 留空 = 用 DSH 当前模型；填了就用本机 Ollama 的该模型。
- 改完**不用重启**；下一次自动检查（≤6 小时）会同步，想立刻生效点「增量更新」/「全量重建」。

优先级：默认值 < 插件 row 的 config（bundle patch） < `config.json` < 设置页 user 层。

### 嵌入来源

| provider | 需要什么 | 备注 |
|---|---|---|
| `cloud`（默认） | 一个 API Key + 兼容 OpenAI 的 `/v1` 地址 | 全量索引 7 天约 0.2~0.5 元；之后增量几分钱 |
| `local` | 本地嵌入服务（默认 Ollama）+ 一个**嵌入模型** | 完全不出网；Ollama 必须带 `--embeddings` 启动，否则报 `This server does not support embeddings` |
| `none` | 什么都不用 | 纯 BM25 字面检索：**只给候选、不确认命中**（长块 BM25 的绝对分不可信，实测过） |

没填 Key 时自动降级成 `none`，填好 Key 后下一次检查会自动重建为语义索引。

## 安装（给第一次用的人）

> **现状（2026-10-31）**：npm 上暂未发布——npm 已关闭命令行建号，网页注册又被反爬拦住了。
> 现在用 **GitHub Release** 分发：
>
> ```
> action: install_bundle
> target: https://github.com/zhaohualiuyuejun/dsh-semantic-recall/releases/download/v0.2.0/dsh-semantic-recall-0.2.0.tgz
> ```
>
> 发布到 npm 之后，`target` 直接填包名 `dsh-semantic-recall` 即可。

### 1. 把包放进机器

```bash
# 发布到 npm 之后（推荐）：plugin_manager 的 target 直接填包名
#   target: dsh-semantic-recall
# 现在（未发布）：clone / 拷目录，用本地路径装
git clone <这个仓库>
# 目录里应当有 package.json / cordis.patch.yml / index.js / client.js / lib/
```

### 2. 用 DSH 的 plugin_manager 装（创造模式）

```
action: install_bundle
target: <上面那个目录的绝对路径>
```

装好后 profile 的 `dsh.profile.bundles` 里出现 `dsh-semantic-recall` 即生效。
**装完刷新一次页面**，左侧「设置」里才会出现「会话语义检索」（客户端 bundle 是页面加载时注入的）。
**不用手改 profile 的 package.json 或 cordis.patch.yml**（bundle 自带 patch）。

### 3. 零配置就能用（只是字面检索）

装完 3 秒，插件会自己扫近 7 天的会话建索引，**不需要 Key、不花钱**。
这时 `session_recall` 能列出「最像的几场对话」，但**不敢确认命中**（故意的，见上面「判定规则」）。

### 4. 开启语义检索（推荐，在设置页点几下就行）

刷新页面后打开 **设置 → 会话语义检索**：

1. 「检索方式」点 **云端**；
2. 把 API Key 粘进「API Key」，点「保存 Key」；
3. 点 **「全量重建」**（第一次没有向量，必须重建一次）。

不填 Key 也能用，只是退化成字面检索（只给候选）。想完全不出网就用 **本地**。

### 5. 每日话题卡（默认就开，什么都不用装）

话题卡默认用 **DSH 自己的当前模型** 总结——装完就有，不需要下载任何东西（会消耗正常额度）。

- **想完全不出网**：设置页「本地模型」里填本机 Ollama 的模型名，并 `ollama pull qwen3:8b`（约 5GB）。
- **不想花额度**：把「启用」关掉即可。

指定了本地模型但 Ollama 不可用时，会**自动跳过**，不影响检索。

### 6. 可选：完全本地嵌入（不出网）

1. 给 Ollama 加 `--embeddings` 启动（否则会报 `This server does not support embeddings`）；
2. `ollama pull bge-m3`（约 1.2GB，是**嵌入模型**，不是对话模型）；
3. 设置页「检索方式」点 **本地** → 模型名填 `bge-m3` → 点「全量重建」。

---

## 第一次跑会发生什么（可预期）

| 阶段 | 表现 |
|---|---|
| 安装后 ~3 秒 | 后台开始扫会话；`session_recall_status` 里 `building: true` |
| 7 天语料（约 2000~3000 块） | 纯字面：1~3 秒；云端语义：**2~5 分钟**（正常现象，不是卡住——页面上有进度条） |
| 费用 | 全量 7 天约 **0.2~0.5 元**；之后增量几分钱 |
| 话题卡 | 建完索引后台开始跑，每天 20~60 秒 |
| 失败时 | `lastBuild.error` + `errorHint` 说清原因（没 Key / 本地服务没开 embeddings / 401…） |

## 卸载

```
action: remove_bundle   target: dsh-semantic-recall
```

索引数据在 `$DSH_HOME/session-recall/`，删掉整个目录即可清干净（**不会碰** `~/.dsh/sessions`）。

## 开发 / 调试

```bash
node tools/probe.mjs 1 demo            # 最小实验：能不能解开 session.v4.jsonl.zstd
node tools/cli.mjs build none 7         # 建纯字面索引（不花钱）
node tools/cli.mjs query "注入攻击" 7    # 查询
node tools/cli.mjs days 7 qwen3:8b       # 生成话题卡（要指定本地模型；CLI 不接 DSH 模型）
node tools/cli.mjs info
```

日志与状态：`$DSH_HOME/session-recall/build.log`、`state.json`、`config.json`。

## 已知限制

- 依赖 `session.v4.jsonl.zstd` 这个格式；DSH 升级换了格式要跟着改 `lib/extract.mjs`。
- 纯字面模式（`none`）只能给候选，别指望它确认命中。
- 话题卡默认走 DSH 自己的模型（会消耗额度）；指定本机 Ollama 时若不可用会自动跳过（不报错）。
- 重排（rerank）实测不稳定，**未启用**。
- 设置页是**插件自己的**（走 `/api/session-recall/*`），不依赖 DSH 的 `settings.update()`——那个路径在 0.2.1-rc.5 上「能读不能写」。

## 版本

- `0.2.0`（2026-10-31）：**首个可对外版本**。自带设置页（界面里填 Key / 勾工作区 / 改天数 / 重建）、改名为 `dsh-semantic-recall`、嵌入改「云端 / 本地」两档、话题卡默认走 DSH 模型、判定改为「高分线 + 词面证据 + 自我引用闸门」。
- `0.1.0`（2026-10-31）：内部版，旁路 MVP 插件化的第一版。
