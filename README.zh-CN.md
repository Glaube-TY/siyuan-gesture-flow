# 手势流 / GestureFlow

[English](./README.md)

思源笔记的鼠标手势插件。

## 当前状态

GestureFlow 正在开发中。以下功能**已完成**：

- **鼠标输入层** — 基于 PointerEvent 的适配器，完整状态机
  (IDLE → PENDING → TRACKING → COMPLETED/CANCELLED)，支持 Pointer Capture、
  捕获阶段监听、Alt 临时禁用、Escape/blur/visibility/取消处理、按钮释放检测。
- **方向识别管线** — 均匀距离采样 → Ramer–Douglas–Peucker 简化 →
  航向分段 → 4/8 方向量化 → 相邻同方向合并。支持平滑圆角转弯，
  不会将圆弧压缩成对角线。
- **识别结果校验** — 超过最大段数的手势标记为无效（而非截断），
  防止误匹配已绑定动作。
- **自动化测试** — 覆盖识别管线、鼠标输入适配器、Canvas Overlay
  （元素生命周期、DPR 缩放、绘制调用、提示边缘钳制、主题变量引用、
  commandLabel 换行）以及 FeedbackController（RAF 合并、定时器竞争、
  PENDING 不可见、卸载清理）。
- **Canvas 轨迹层** — 固定全视口 Canvas 实时绘制鼠标轨迹，DPR 自适应缩放，
  提示元素显示当前方向序列（如 `R → D`），更新通过 `requestAnimationFrame` 合并。
- **命令注册表** — 类型化的 `CommandRegistry`，支持原子批量注册、分组元数据
  和统一的 `CommandExecutionResult` 语义。
- **内存手势绑定** — `GestureBindingRegistry` 将方向序列映射到命令，
  支持 ID 唯一性、深拷贝不可变性、按方向 / 按 ID 启停。
- **思源动作桥接** — `SiyuanActionBridge` 集中所有思源 API 访问（无 HTTP、无 Token）。
  实现相邻标签页切换（`getActiveTab` → `Wnd.switchTab`）和文档滚动到顶部/底部
  （`getActiveEditor` → `editor.protyle.scroll.element`）。
- **命令派发器** — `GestureCommandDispatcher` 在执行前验证会话状态、识别结果
  和绑定存在性，确保每个会话最多执行一次命令。

以下功能**尚未实现**：

- 设置页面
- 配置持久化
- 破坏性动作（关闭标签页、删除文档、新建文档、定位文档树）
- 触控板 / 触摸输入

## 架构

```
src/
  commands/
    CommandRegistry.ts          原子命令注册
    CommandExecutor.ts          统一执行 + 去重 + 错误捕获
    GestureCommandDispatcher.ts 会话 → 绑定 → 命令派发
    SiyuanActionBridge.ts       所有思源 API/DOM 访问（标签页、滚动）
    registerBuiltinCommands.ts  默认标签页/滚动命令
    types.ts                    命令 / 上下文 / 结果类型
  gesture/
    input/
      InputAdapter.ts           抽象输入适配器基类
      MouseGestureAdapter.ts    鼠标 PointerEvent 适配器
    recognition/
      PathSampler.ts            均匀弧长重采样
      PathSimplifier.ts         RDP 简化 + 抖动/短段处理
      DirectionVectorizer.ts    航向分段 + 方向量化
      DirectionMatcher.ts       相邻同方向合并
      recognition.test.ts       管线测试
    overlay/
      GestureOverlay.ts         Canvas 轨迹 + 提示元素
      overlay.test.ts           Overlay 测试
      types.ts                  Overlay 专用类型
    bindings/
      GestureBindingRegistry.ts 方向 → 命令绑定（不可变，ID 索引）
      defaultBindings.ts        L/R/U/D → tabs.previous/next, scroll.top/bottom
      CommandLabelResolver.ts   为 Overlay 解析命令标签
    GestureEngine.ts            管线编排
    GestureSession.ts           单次手势状态 + 点累积
    GestureFeedbackController.ts  RAF 合并 + 实时识别 + 异步回调
    types.ts                    共享类型和枚举
  index.ts                      插件入口 — 装配、开发日志、卸载清理
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
| `pnpm build` | 生产构建 → `dist/` + `package.zip` |
| `pnpm check` | TypeScript / Svelte 类型检查 |
| `pnpm test` | 运行全部 vitest 测试 |
| `pnpm verify` | 验证 `dist/` 和 `package.zip` 包含必需文件、无禁止文件 |
| `pnpm make-install` | 构建 + 复制到思源插件目录 |

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
