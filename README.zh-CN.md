# 手势流 / GestureFlow

[English](./README.md)

思源笔记的鼠标手势插件。

## 当前状态

GestureFlow 正在开发中。以下功能**已完成**：

- **鼠标输入层** — 基于 PointerEvent 的适配器，完整状态机
  (IDLE → PENDING → TRACKING → COMPLETED/CANCELLED)，支持 Pointer Capture、
  捕获阶段监听、Alt 临时禁用、Escape/blur/visibility/取消处理、按钮释放检测。
  采用**"先截获、后决定"**的 `contextmenu` 协调模型：右键会话活动期间
  （PENDING 或 TRACKING）收到的 `contextmenu` 一律在 `window` 捕获阶段截获；
  若会话最终只是普通右键（PENDING 释放），则通过微任务重放一次，让思源菜单
  正常出现；若形成手势（TRACKING）或被取消，则丢弃快照，不弹菜单。重放事件
  使用 `WeakSet` 标记，避免递归拦截。
- **方向识别管线** — 均匀距离采样 → Ramer–Douglas–Peucker 简化 →
  航向分段 → 4/8 方向量化 → 相邻同方向合并。支持平滑圆角转弯，
  不会将圆弧压缩成对角线。
- **识别结果校验** — 超过最大段数的手势标记为无效（而非截断），
  防止误匹配已绑定动作。
- **冒烟测试（少量、长期保留）** — 仅纯逻辑套件：识别管线、配置迁移、
  快捷键工具、绑定操作。生产正确性由 `pnpm check` → `pnpm build` →
  `pnpm verify` 保证；UI / 指针 / 生命周期行为在真实思源实例中验证。
- **Canvas 轨迹层** — 固定全视口 Canvas 实时绘制鼠标轨迹，DPR 自适应缩放，
  提示元素显示当前方向序列（如 `R → D`），更新通过 `requestAnimationFrame` 合并。
- **命令注册表** — 类型化的 `CommandRegistry`，支持原子批量注册、分组元数据
  和统一的 `CommandExecutionResult` 语义。
- **内存手势绑定** — `GestureBindingRegistry` 将方向序列映射到命令，
  支持 ID 唯一性、深拷贝不可变性、按方向 / 按 ID 启停。
- **思源动作桥接** — `SiyuanActionBridge` 集中所有思源 API 访问（无 HTTP、无 Token）。
  实现相邻标签切换（`getActiveTab` → `Wnd.switchTab`）、关闭当前标签页
  （`getActiveTab(true)` → `tab.parent.removeTab(tab.id)`）、文档滚动到顶/底部，
  以及重新加载当前文档（`getActiveEditor(true)` → `editor.reload(false)`）。
  实现相邻标签页切换（`getActiveTab` → `Wnd.switchTab`）和文档滚动到顶部/底部。
  滚动优先复用思源官方 `protyle-scroll__up` / `protyle-scroll__down` 按钮
  （内部调用 `goHome` / `goEnd`，可处理动态加载文档）；若不可用，则回退到设置
  `editor.protyle.contentElement.scrollTop`。注意：
  `editor.protyle.scroll.element` 是**块索引滑杆**（`protyle-scroll__bar`），
  不是滚动容器 — 桥接绝不对其调用 `scrollTo` / `scrollTop`，仅通过
  `parentElement` 定位官方滚动控件。
- **内置功能** — 六个命令，按分组显示在设置界面：`tabs.previous` / `tabs.next` /
  `tabs.close`（分组**标签页**）、`document.reload`（分组**文档**）、`scroll.top` /
  `scroll.bottom`（分组**滚动**）。`tabs.close` 仅关闭当前活动 Wnd 中的普通标签页；
  `document.reload` 仅重新加载当前活动文档编辑器，两者都不是浏览器式标签刷新，
  也不影响其他标签页。6B-1 新增的两个命令**没有默认手势**，需在绑定页手动选择绑定。
- **动作派发器** — `GestureActionExecutor`（取代旧的 `GestureCommandDispatcher`）
  在执行前验证会话状态、识别结果和绑定存在性，并按 `action.type` 派发：内置命令
  走 `CommandExecutor`，键盘快捷键走 `ShortcutExecutor`，每个会话最多执行一次。
- **版本化配置** — 严格类型的配置模型，包含版本字段（当前 **版本 2**）、深拷贝
  默认值、统一校验/规范化和迁移框架（v1 → v2 将旧的顶层 `commandId`/
  `commandParams` 包装为 `builtin` action；迁移结果会写回存储并报告为
  `migrated`）。`ConfigManager` 持有内存快照，通过 `Plugin.loadData` /
  `Plugin.saveData` 串行持久化，向订阅者推送独立深拷贝。导入走与首次加载相同
  的迁移 + 校验管线；无效数据回退默认配置。
- **设置页面** — 基于完整宽度的独立思源 `Dialog` 承载的 Svelte 设置对话框
  （非 `Setting.addItem`）。包含常规（启用、临时禁用键、激活距离、超时）、识别
  （方向模式、采样、简化、段限制）、显示（轨迹/提示开关、线宽）、绑定（完整手势
  录制 + 新增/编辑/删除/启停；每个绑定可绑定到**内置功能**或**快捷键**；
  JavaScript 仅为"开发中"占位不可选）、数据（导出、导入、恢复默认）五个标签页。
  所有用户文本来自 i18n；快速连续编辑经防抖合并，不会每个按键重启运行时。
- **键盘快捷键** — `ShortcutSpec`（key/code/keyCode + 四个修饰键的严格可序列化
  结构）由 `ShortcutRecorder` 录入，统一经 `validateShortcutSpec` 校验，按平台
  `detectShortcutPlatform` 展示（Windows/Linux `Ctrl+Shift+P`，macOS `⌃⇧P`），
  由 `ShortcutExecutor` 以合成 `keydown` 派发到当前焦点。合成事件永不
  `isTrusted`，因此主动拒绝非真实键盘事件的插件无法被触发。
- **运行时管理器** — `GestureFlowRuntime` 封装 Adapter、Engine、Overlay、命令和
  绑定的完整生命周期。`restart` 先完整停止旧运行时（detach adapter、销毁 overlay、
  清除计时器和重放 token），再用新配置启动。`enabled = false` 时不挂载任何输入
  监听器或 Overlay。

以下功能**尚未实现**：

- JavaScript 动作（设置界面仅"开发中"占位）
- 删除文档、新建文档、定位文档树
- 恢复最近关闭标签页、关闭其他/全部标签页
- 后退 / 前进导航、全局搜索
- 触控板 / 触摸输入
- 滚轮手势、Rocker 手势、超级拖拽
- 跨插件快捷键激活协议（拒绝合成 `isTrusted: false` 事件的插件，
  如 siyuan-homepage 的自定义快捷键，无法被 GestureFlow 快捷键触发）

## 架构

```
src/
  commands/
    CommandRegistry.ts          原子命令注册
    CommandExecutor.ts          统一执行 + 去重 + 错误捕获
    SiyuanActionBridge.ts       所有思源 API/DOM 访问（标签切换、标签关闭、
                              文档滚动、文档重新加载）
    registerBuiltinCommands.ts  默认标签页/滚动命令
    types.ts                    命令 / 上下文 / 结果类型
  actions/
    GestureActionExecutor.ts    会话 → 绑定 → 动作派发（builtin/shortcut）
  shortcuts/
    types.ts                    严格可序列化 ShortcutSpec
    shortcutUtils.ts            捕获 / 规范化 / 校验 / 展示 / 平台检测
    ShortcutExecutor.ts         合成 keydown 派发
  config/
    types.ts                    版本化配置 schema（版本 2，严格类型）
    defaults.ts                 默认配置 + 深拷贝工具
    validate.ts                 校验 + 规范化（范围钳制、类型检查）
    migrations.ts               版本检测 + 迁移框架（v1 → v2）
    ConfigManager.ts            持久化所有者（load/save/import/export/reset/subscribe）
  gesture/
    input/
      InputAdapter.ts           抽象输入适配器基类
      MouseGestureAdapter.ts    鼠标 PointerEvent 适配器
    recognition/
      PathSampler.ts            均匀弧长重采样
      PathSimplifier.ts         RDP 简化 + 抖动/短段处理
      DirectionVectorizer.ts    航向分段 + 方向量化
      DirectionMatcher.ts       相邻同方向合并
    overlay/
      GestureOverlay.ts         Canvas 轨迹 + 提示元素（配置驱动）
      types.ts                  Overlay 专用类型
    bindings/
      GestureBindingRegistry.ts 方向 → 绑定查找（动作无关，不可变）
      defaultBindings.ts        默认 L/R/U/D 内置绑定
      CommandLabelResolver.ts   为 Overlay 解析动作标签
    GestureEngine.ts            管线编排
    GestureSession.ts           单次手势状态 + 点累积
    GestureFeedbackController.ts  RAF 合并 + 实时识别 + 异步回调
    types.ts                    共享类型和枚举
  runtime/
    GestureFlowRuntime.ts       生命周期管理器 — 启动/停止/重启全部组件
  settings/
    SettingsDialog.ts           完整宽度的独立设置对话框封装（非全屏窗口）
    SettingsPanel.svelte        Svelte 设置对话框（常规/识别/显示/绑定/数据）
    settingsHelpers.ts          纯工具函数（parseNumber, DebouncedPatchScheduler）
  index.ts                      插件入口 — 配置管理器、运行时、设置、卸载
```

## 开发

### 前置条件

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

### 安装

```bash
pnpm install
```

### 脚本

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 监听模式构建，带 inline sourcemap（开发目录镜像） |
| `pnpm check` | 仅类型检查生产代码（tsconfig 排除测试） |
| `pnpm build` | 生产构建 → `dist/` + `package.zip` |
| `pnpm verify` | 验证 `dist/` / `package.zip`（必需/禁止文件、凭据扫描、`index.css` 样式隔离） |
| `pnpm test:smoke` | 运行少量长期保留的冒烟测试（`tests/smoke/`） |
| `pnpm test` | 等价于 `pnpm test:smoke` |
| `pnpm release:check` | 生产优先门禁：`check` → `build` → `verify` → `test:smoke` |
| `pnpm make-install` | 构建 + 复制到思源插件目录 |

### 开发流程（生产优先）

严格按此顺序执行，测试不得排在类型检查与构建之前：

1. `pnpm check` — 生产类型检查（测试已被 tsconfig 排除，测试错误不会阻塞生产检查）。
2. `pnpm build` — 生产构建。
3. `pnpm verify` — 产物验证，含 `dist/index.css` 样式隔离检查。
4. `pnpm test:smoke` — 少量纯逻辑冒烟测试。

真实思源交互（右键菜单、手势录制、设置弹窗、主题、标签页切换、滚动、
快捷键录入/测试、导入导出、重启后配置保留）一律以构建后的真实思源手动测试为准，
不使用浏览器 Mock。

### 开发部署

本插件采用**真实目录镜像**部署方式（非符号链接）。
首次运行 `pnpm dev:setup` 配置目标思源 `data/plugins` 目录，
之后 `pnpm dev` 会在每次重建时同步变更。

## 打包

`pnpm build` 生成 `package.zip`，包含：

- `index.js` — 打包后的插件入口
- `index.css` — 样式文件（如有）
- `plugin.json` — 插件元数据
- `icon.png`、`preview.png`
- `i18n/*.json`
- `README*.md`

本插件为**纯 Frontend Plugin** — 不包含 `kernel.js`。

## 许可证

MIT
