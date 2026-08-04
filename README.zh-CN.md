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
- **自动化测试** — 覆盖识别管线和输入适配器。
- **Canvas 轨迹层** — 固定全视口 Canvas 实时绘制鼠标轨迹，DPR 自适应缩放，
  提示元素显示当前方向序列（如 `R → D`），更新通过 `requestAnimationFrame` 合并。

以下功能**尚未实现**：

- 动作注册表和思源具体动作（切换标签页、滚动、触发命令等）
- 设置页面
- 触控板 / 触摸输入

## 架构

```
src/gesture/
  input/
    InputAdapter.ts         抽象输入适配器基类
    MouseGestureAdapter.ts  鼠标 PointerEvent 适配器
  recognition/
    PathSampler.ts          均匀弧长重采样
    PathSimplifier.ts       RDP 简化 + 抖动/短段处理
    DirectionVectorizer.ts  航向分段 + 方向量化
    DirectionMatcher.ts     相邻同方向合并
    recognition.test.ts     管线测试
  overlay/
    GestureOverlay.ts       Canvas 轨迹 + 提示元素
    overlay.test.ts         Overlay 测试
    types.ts                Overlay 专用类型
  GestureEngine.ts         管线编排
  GestureSession.ts        单次手势状态 + 点累积
  GestureFeedbackController.ts  RAF 合并 + 实时识别
  types.ts                 共享类型和枚举
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
