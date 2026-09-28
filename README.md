# prompt-builder

本地跑的图片反推台：丢一张图进去，吐一条可直接用的正向提示词。两种写法各走一套 —— **Anima** 出 danbooru tag 串，**Krea2 / Qwen** 出「元信息 tag 行 + 一段英文散文」。

> 全部跑在本机，图片和提示词不出这台机器。出图交给 ComfyUI，三套工作流（Anima / Krea2 / Qwen2.1）在界面里挑。

## 下载即用

1. 到 **Releases** 下载 `Anima-Reverse-Bench_v1.0.zip` —— 里面带 `Anima启动器.exe`，解压即用
2. 双击 `Anima启动器.exe` → 点 **开始**
3. 浏览器自动开工作台，在「设置」里加模型商连接（key 只存在你本机浏览器）

也可以直接克隆这个仓库：装好 Python 3.10+，双击 `start.bat`，或 `python server.py`（`Anima启动器.exe` 不随仓库走，它 11 MB，走 Release 发）。

---

本地跑的图片反推工具。丢一张图进去，只吐一条正向提示词（Anima 走 tag，Krea2 / Qwen 走散文），别的什么都不干。

## 目录

```
反推/
├── Anima启动器.exe       双击这个起服务（浅蓝界面：开始 / 停止 / 日志 / 外观设置）
├── launcher.py           启动器的源码（改了要重新打包才有新 exe）
├── make_icon.py          画图标的脚本（纯 Python 手搓 PNG/ICO，不用装 PIL）
├── index.html            门户页（访问 / 就是它）
├── reverse.html          反推台（Anima / Krea2·Qwen 两模式共用同一个页面）
├── assets/               ← 前端代码，按职责分家
│   ├── base.css          配色变量 + reset + 通用组件（两页共用）
│   ├── icon.ico          应用图标（exe 用，含 256→16 六个尺寸）
│   ├── icon.png          同一张图的 PNG（网页 favicon + 启动器窗口图标）
│   ├── reverse.css       反推台专属布局
│   ├── portal.css        门户专属布局
│   ├── core.js           命名空间 AB、全局状态、存储、小工具
│   ├── theme.js          日夜主题
│   ├── net.js            所有网络请求（服务端 / 模型商 / ComfyUI）
│   ├── prompt.js         system 组装、输出清洗、追加 tag
│   ├── images.js         投喂区、超限压缩、轮次窗口、清空
│   ├── clients.js        模型商连接：顶栏选择器 + 增删改
│   ├── chat.js           消息渲染、加 tag、出图
│   ├── app.js            装配层：事件绑定、发送、启动
│   └── portal.js         门户页逻辑
├── data/                 ← 只放文本数据，改规则只碰这里
│   ├── presets.js        预设包（base / presets 列表 / 输出协议）· anima
│   ├── presets-krea2.js  预设包 · krea2（tag 行 + 散文）           ← krea2 走这套
│   └── library.js        参考词库 14 章 · 只对 anima 生效
├── comfy/                ← 出图工作流，全是 API 格式
│   ├── api_template.json     anima 那套（WeiLin 提示词编辑器）
│   ├── api_krea2_t2i.json    Krea2 文生图（CLIP文本编码 / 保存图像）
│   └── api_qwen21_t2i.json   Qwen2.1 文生图（Text Encode Qwen Image 2.1 / 保存图像（高级））
├── comfy_out/            出图落地
├── providers.json        模型商连接（只存地址与模型清单，key 不在这）
├── server.py             本地服务
├── start.bat             双击启动
└── README.md
```

### 改东西该看哪个文件

| 想改什么 | 打开 |
|---|---|
| 提示词规则、预设包文案 | `data/presets.js`（anima）／ `data/presets-krea2.js`（krea2） |
| 词库词条 | `data/library.js` |
| 配色、日夜主题 | `assets/base.css` |
| 界面布局 | `assets/reverse.css` / `portal.css` |
| 请求怎么发、转发给谁 | `assets/net.js` |
| 出图引擎、工作流节点名 | `server.py` 顶部 `ENGINES` + `comfy/*.json` |
| 输出清洗、违禁词表 | `assets/prompt.js` |
| 图片压缩阈值、轮次窗口 | `assets/images.js` |
| 模型商管理 | `assets/clients.js` |
| 按钮行为、快捷键 | `assets/app.js` |
| 启动器界面、日志、外观设置 | `launcher.py` |

模块靠 `window.AB` 通信，加载顺序写在 `reverse.html` 底部的 script 标签里，数据层（data/）必须排在逻辑层前面。

## 模式

打开 `http://127.0.0.1:8899` 是门户页，两个入口：

| | 地址 | 状态 |
|---|---|---|
| **Anima 反推** | `reverse.html` | 可用 |
| **Krea2/Qwen 反推** | `reverse.html?mode=krea2` | 可用 |
| **打标模式** | — | 占位，方案未定 |

反推页左上角有 `‹` 返回门户。主题设置两个页面共用。

## 用法

1. 双击 **`Anima启动器.exe`**（或 `start.bat`，它也会优先拉 exe）
2. 启动器里点 **开始** —— 服务起来，浏览器自动打开工作台
3. 顶部挑预设包 + 模型商 + 模型
4. 左栏拖图（或 Ctrl+V 粘贴），底部写要求（可留空），回车
5. 出来就是一整条正向提示词，点「复制」

不启动 server 也能用：设置里切「浏览器直连模型商」，填好 key 即可。缺点是可能被 CORS 拦。

## 启动器

窗口浅蓝，三块：

| 位置 | 干什么 |
|---|---|
| 顶栏按钮 | **开始** 起服务、**停止** 关服务、**打开工作台** 拉浏览器；右边状态灯显示 `运行中 :8899` / `已停止` / `端口占用` |
| 端口 | 想换端口就在框里改，改完点开始（默认 8899） |
| 运行日志 | 服务的每行输出都打在这儿，不再弹黑框；有「清空」 |
| 网页外观 | **选图片** 换工作台背景图、**恢复默认** 退回 `assets/bg.jpg`、**不透明度** 滑块 0–60（拖完自动存） |

外观设置存在 `providers.json` 的 `ui` 段：

```json
"ui": { "bg_opacity": 16, "bg_image": "assets/bg.jpg" }
```

- 选了新图会被拷成 `assets/bg_custom.<后缀>`，`bg_image` 指向它
- 网页开机从 `/api/ui` 取这份设置，覆盖本机 localStorage，所以换机换浏览器都一致
- 网页设置面板里那个滑块也能调，松手会写回服务端（两边始终对得上）
- `bg_image` 存的是相对路径（如 `assets/bg_custom.jpg`），前端会自动补成 `/assets/...` 再喂给 CSS。**这个前导斜杠删不得**：`url()` 写在自定义属性里时是按引用它的样式表（`/assets/base.css`）解析的，用相对路径会变成 `/assets/assets/xxx`，图直接 404，背景就成纯色了

**自己重新打包 exe**（改了 `launcher.py` 才需要）：

```bat
python -m PyInstaller --noconfirm --onefile --noconsole --name "Anima启动器" ^
  --icon "%CD%\assets\icon.ico" ^
  --distpath . --workpath _build --specpath _build launcher.py
```

两个坑写在这儿免得再踩：

- `server.py` 是启动时用 `importlib` 动态载入的，打包器扫不到它的依赖，所以 `launcher.py` 顶部显式 import 了 `http.server` / `mimetypes` / `hashlib` / `socket` 等一堆，删不得
- exe 是窗口版，`sys.stdout` 是 `None`，`launcher.py` 已经兜住；要自检就跑 `Anima启动器.exe --selftest`，结果写进同目录的 `_selftest.txt`
- `--icon` 的路径会被当成相对 `--specpath`（也就是 `_build/`）解析，写相对路径会报 `FileNotFoundError`，所以上面用了 `%CD%` 拼绝对路径

## 图标

那张图标是 `make_icon.py` 用纯 Python 画出来的（这台机器没装 PIL）：圆角浅蓝底 + 深蓝小企鹅，白脸、橙嘴、粉腮，超采样做过抗锯齿，一次导出 256 / 128 / 64 / 48 / 32 / 16 六个尺寸。

- **exe 图标** → 打包时用 `--icon assets/icon.ico` 嵌进去（换图标后得重新打包）
- **窗口 / 任务栏** → `launcher.py` 用 `iconphoto` 挂 `assets/icon.png`
- **浏览器标签页** → 两个页面都有 `<link rel="icon" href="assets/icon.png">`

想改颜色或造型，直接动 `make_icon.py` 顶部的配色常量和那几个形状参数，跑一遍就会重写 `assets/icon.ico` 与 `assets/icon.png`。

**打不开/起不来**：端口被占 → 换端口或关掉上一个服务窗口；`载入 server.py 出错` → exe 必须和 `server.py` 放同一层。

## 预设包

| id | 用途 |
|---|---|
| standard | 默认主力。11 槽位完整反推 |
| modify | 接着上一版改，没说的地方一个字不动 |
| strict | 用户贴来一串 tag 时用，只重排去重，不新增设定 |
| enhance | 用户说「细化/丰富」时用，补的词必须图上能指认 |
| minimal | 只要人物和服装，裁掉场景镜头 |
| nsfw | 体位 / 束缚 / 多人 / 表情强度 / 体液层次 |
| tagtranslate | 自然语言描述转结构串 |

预设包 = `presets.js` 里的 `base`（公共规则：槽位顺序、互斥表、禁止词、防崩坏红线）+ 各预设的 `rules` + `protocol`（只输出裸串）。
要加自己的预设，在 `window.PRESET_PACK.presets` 数组里加一项即可。

### Krea2 预设包（`presets-krea2.js`）

规则文本出自 `krea2-prompt-builder` skill。输出是固定两段式：**第一行元信息 tag**（画质 / 美学 / 画风 / 安全分级，四选一且必须诚实），空一行，**接着一整段 80–160 词的英文散文**——画面内容一律不拆 tag，拆了画面就平。

| id | 用途 |
|---|---|
| standard | 默认。图 → 两段式，按「机位景别 → 主体 → 姿态 → 光与微动态」四步定词 |
| polish | 已有 Krea2 提示词润色：只换词、补光影与动态，长度放宽到 180 词 |
| convert | tag 串或中文描述 → 归到九要素，改写成两段式 |
| trim | 只要人物 / 不要背景 / 压到 60 词：照指令裁，没说到的要素一个字不动 |

## Krea2/Qwen 反推模式

同一套界面、同一套反推机制，只在这几处和 anima 分家：

- **提示词**：走 `presets-krea2.js`，不再是 `presets.js`
- **输出清洗**：anima 把多行压成一整条 tag 串；krea2 保住「tag 行 + 空行 + 散文」的两段结构，只把散文内部的换行并回一段
- **参考词库**：danbooru 词库只对 anima 有意义，krea2 下顶栏那两个字段和设置里整块都收起，system 里一个词都不挂
- **加 tag 按钮**：krea2 是整段散文，往里插 tag 没意义，按钮直接不出现
- **预设包记忆**：两套各记各的（`cfg.preset` / `cfg.presetK2`），来回切模式不串味
- **图库照旧**：Danbooru 那套（搜图 / 搜 tag / 发送图片 / 发送 tag）两模式共用，一个字没改
- **出图**：点「生成图片」时先弹两个按钮问引擎——**Krea2** 走 `api_krea2_t2i.json`，**Qwen2.1** 走 `api_qwen21_t2i.json`；anima 模式不问，固定走老模板
- **连接 / 图片记忆**：和 anima 完全共用，成品一律落 `comfy_out/`

改 krea2 的规则只碰 `data/presets-krea2.js`，anima 那条路一个字节都不动。

## 参考词库

`presets.js` 里除了 skill 的规则，还内置了 `anima-tag-library.md` 的全文，切成 14 章：

- 设置面板 → **参考词库**，逐章勾选，勾中的拼进每轮系统提示
- 三个快捷按钮：**核心包**（主体层 / 外貌层 / 服装层 / 镜头层）、**全量**、**清空**
- 右侧标着每章字数，底部汇总「已挂 N 章／约 X 字」

体感参考：不挂词库时系统提示 4649 字，挂核心包 15451 字，挂全量 27242 字。**默认一个都不挂**——词库能让用词更准，但每轮都要重发，token 是真金白银，按需开。

## 添加模型商

不在文件里手写配置，全在界面上点：

1. 设置 → **+ 添加连接**
2. 填「接口地址」（到 `/v1` 为止，比如 `https://api.deepseek.com/v1`）+「API Key」
3. 点 **拉取模型** —— 服务端代你请求 `/models`，把清单全拉回来（绕开浏览器 CORS）
4. 在列表里勾选要用模型（有过滤框），可多选，点 **保存连接**
5. 顶部「连接」下拉切连接，「模型」下拉切模型

连接可以加多个，各自独立存 key 和已选模型。

**key 只存在本机浏览器（localStorage）**，不会写进 `providers.json` —— 那个文件里只有连接地址与模型清单，转发请求时 key 由浏览器临时带上，服务端不落盘。老版本留在文件里的 key 会在首次启动时自动搬进浏览器，并把文件擦干净（页面会提示「已把 N 个 key 挪到本机浏览器」）。

⚠️ **必须勾选能吃图的模型**，纯文本模型反推图片会失败。

## 图库（Danbooru）

顶栏 `ANIMA / REVERSE BENCH` 后面有两个页签：**反推** / **图库**，点一下切。

图库能干的：搜图、搜 tag、看大图、把某张图的 tag 按分类摊开。

| 动作 | 结果 |
|---|---|
| 点缩略图 | 右侧出大图 + 四类 tag（Artist / Copyright / Character / General） |
| **单击** tag | 进上面的搜图栏，随即搜它（已有则不重复加，可攒成组合） |
| **双击** tag | 进反推栏的**补充要求** |
| 点「发送本类」 | 整类 tag 一起进补充要求 |
| 点「发送全部 tag」 | 四类合并进补充要求 |
| 点「发送图片」 | 图取回本地，直接进**投喂区**，并自动切回反推页 |
| 搜 tag 模式 | 列出 tag 及分类，点名字继续搜图 |
| 输入框补全 | 打两个字以上弹候选（带分类和帖子数），↑↓ 选，Enter/Tab 确认 |

单击与双击要做区分，所以单击有约 0.23 秒延迟——双击时那次单击会被撤销，不会误触发搜索。

**代理**：D 站在墙外，直连超时。`providers.json` 的 `danbooru.proxy` 填上你的本地代理（默认已填 `http://127.0.0.1:7897`）。图片也走本地代理并缓存在 `dan_cache/`，第二次看同一张不再走网络。填了 `login` + `api_key` 可以突破匿名 2 个 tag 的搜索限制。

**直链**：`reverse.html?view=dan&q=hatsune_miku` 可直达图库并自动搜。

## 加 tag

每条结果下面的按钮排里有 **加 tag**：点开输入框，填要补的词，回车追加。可一次填多个，用 `;` 或 `,` 分隔。

- 追加位置：插在**末尾那句叙事句之前**，不是无脑丢到最尾——Anima 对顺序敏感，tag 该在叙事前
- 已有同 tag 不会重复添加（同概念只写一次是硬规则）
- 追加后，复制、生成图片、下一轮对话上下文用的都是新串

例：`1girl, solo, long hair, upper body, a girl smiles at the viewer.`
补 `hatsune miku (vocaloid); vocaloid` 之后 →
`1girl, solo, long hair, upper body, hatsune miku (vocaloid), vocaloid, a girl smiles at the viewer.`

## 出图（ComfyUI）

反推结果下面有个 **生成图片** 按钮，点了才把提示词发去 ComfyUI 出图；不点就只是反推，一条请求都不往外发。

三套引擎各配一份 API 格式工作流，都在 `comfy/` 下：

| 引擎 | 工作流 | 提示词入口（按标题认） | 成品出口 | 什么时候用 |
|---|---|---|---|---|
| anima | `api_template.json` | WeiLin 提示词编辑器 · `positive` | 二采样 | Anima 反推，固定这套 |
| krea2 | `api_krea2_t2i.json` | CLIP文本编码 · `text` | 保存图像 | Krea2/Qwen 模式，出图时选它 |
| qwen | `api_qwen21_t2i.json` | Text Encode Qwen Image 2.1 · `prompt` | 保存图像（高级） | 同上，想走 Qwen2.1 就点它 |

- **点「生成图片」先问一句**：Krea2/Qwen 模式下同一段提示词能喂两套工作流，所以按钮点下去先弹「Krea2 文生图 / Qwen2.1 文生图」两个按钮，上次选的那套标着「· 上次」；anima 模式没得选，点了直接跑
- **节点按标题找，不按 id**：`server.py` 顶部 `ENGINES` 里写的是节点标题，工作流改版换了 id 也不用动代码；标题对不上才退回配置里的 fallback id
- **提示词字段自动认**：配置的字段不在，就按 `positive` → `text` → `prompt` 的顺序找
- 成品统一落 `comfy_out/`，文件名 `comfy_年月日_时分秒_NNN.png`
- ComfyUI 地址默认 `http://127.0.0.1:8188`，设置里可改
- ComfyUI 没开就点，只会弹一句「请先打开 ComfyUI」，不做任何预检测

**换工作流时**：在 ComfyUI 里改好 → 菜单 `工作流 → 导出（API）` → 覆盖 `comfy/` 下对应那份。节点名换了就改 `server.py` 顶部 `ENGINES` 里那几行。

## 输出过滤

模型偶尔会硬塞 `masterpiece, best quality, anime style` 这类词，前端有一道过滤把质量词、画风词、光影词、写实词按 tag 剔除后再给你。`dim lighting` / `night` / `rain` 这类时辰环境词保留。


## 图片记忆

默认保留最近 5 轮的图片。第 6 轮开始时，第 1 轮的图片数据从内存里抹掉（缩略图显示 MEMORY PURGED），后续只带文字上下文。
轮次上限在设置里可调。图片以 base64 随请求发送，清掉就是真清掉，不会残留在后续请求体里。

## 常见问题

**拉不到模型 / 报 failed to fetch** — 直连被跨域拦了。切回代理模式，确认 `start.bat` 开着。

**上游 404** — `api_base` 写错了，或者那家中转不是 OpenAI 兼容端点。

**图片发过去模型说看不到图** — 换 vision 模型；或图太大，压缩到 1280px 以内再传。
