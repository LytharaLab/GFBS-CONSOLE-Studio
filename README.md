# GFBS 3D-CONSOLE Studio 0.1.0

GFBS 3D-CONSOLE Studio 是 LytharaLab 为 **GFBS-Main / 3D-CONSOLE** 制作的 Blockbench 桌面插件。它把 `data/<namespace>/gfbs_console/scenes/*.json` 直接作为可视化编辑格式；GFBS Scene JSON 始终是 source of truth，不需要 `.bbmodel` 中间文件。

## 运行要求

- Blockbench Desktop **5.0+**（开发与兼容性检查基于当前 Blockbench 5.1.x API）
- GFBS-Main 当前 `3D-CONSOLE format_version: 1`
- glTF 链接预览建议把场景放在标准 Forge/Gradle 项目中，或在插件中手工指定 Minecraft 项目根目录

## 安装

1. 打开 Blockbench Desktop。
2. 打开 **File → Plugins...**。
3. 选择从本地文件加载插件（Load Plugin from File）。
4. 选择 `dist/gfbs_console_studio.js`。
5. 安装成功后，Blockbench 会出现 **GFBS 3D-CONSOLE Scene** 格式，以及 **Tools → GFBS 3D-CONSOLE** 工具菜单。

也可以直接使用发布包根目录旁单独提供的 `gfbs_console_studio.js`。

## 打开现有场景

推荐直接使用：

**File → Import → Open GFBS 3D-CONSOLE Scene...**

选择例如：

```text
src/main/resources/data/gfbs_main/gfbs_console/scenes/example_console.json
```

插件也注册了 JSON `load_filter`，因此符合 GFBS Scene 结构的 JSON 可以由 Blockbench 的模型文件加载流程识别；普通 Minecraft model JSON 不会被该过滤器认领。

打开后：

- Outliner = Console Scene Tree
- Blockbench Move / Rotate / Scale Gizmo = GFBS `transform`
- 16 Blockbench units = 1 Minecraft block
- Ctrl+S = 直接写回当前 GFBS Scene JSON
- **File → Export → Export GFBS Scene JSON...** = Save As / Export

> GFBS JSON 使用 `Project.export_path` / GFBS Codec 保存，不会被当成 `.bbmodel` 的 `Project.save_path`。

## 已实现功能

### Scene / Node Tree

- 当前全部内建节点类型：
  - `node`
  - `node_3d`
  - `model`
  - `text`
  - `indicator`
  - `animation`
  - `sound`
  - `timer`
  - `linear_layout`
  - `grid_layout`
  - `surface_layout`
  - `interaction`
  - `button`
  - `toggle`
  - `knob`
  - `lever`
  - `slider`
- 自定义第三方 ResourceLocation node type
- 第三方 spatial node 标记，可保留并编辑 transform
- 父子 Scene Tree
- 移动 / 旋转 / 缩放 / pivot
- GFBS `XYZ` Euler 顺序
- `linear/grid/surface` layout 的编辑器预览偏移
- 未知 node JSON 字段保留
- 未知 scene 顶层字段保留

### Properties

Scene root 和每个 node 都有结构化 Property 管理器，支持当前 runtime 类型：

- `boolean`
- `integer`
- `long`
- `double`
- `string`
- `color`
- `vec3`
- `resource`

支持：

- default
- sync
- save
- interpolate
- 内建 property 类型冲突检查
- `ConsoleNode3D` 内建 `visible` / `enabled`
- Text / Model / Interaction / Animation / Sound / Timer 的内建 property 地址识别

### Model Node

- `source.adapter`
- `source.location`
- glTF / GLB 链接预览
- 使用 Blockbench 自带 `THREE.GLTFLoader` 作为主预览路径
- 静态 core glTF reader 作为失败兜底
- 自动解析 Minecraft Forge 项目资源路径：
  `src/main/resources/assets/<namespace>/...`
- Part Alias 管理器
- glTF node 名称扫描
- Material Profile 管理器
- `pbr / unlit / neon`
- color / alpha
- emissive color / strength
- neon strength
- fullbright / visible

`gfbs_main:vanilla_json` 的 ResourceLocation、transform、part alias、material profile 会完整编辑和保存；视口使用空间代理预览。Forge `BakedModel/ModelManager` 只能在 Minecraft runtime 内获得，因此 Blockbench 不会假装复刻那套烘焙结果。

### Text Node

- text
- pixel_scale
- properties
- 视口尺寸代理预览

### Interaction / Controls

- `max_distance`
- `min / max / step`
- Generic interaction control type
- 完整 hit shape 编辑：
  - box / aabb / obb
  - sphere
  - cylinder
  - plane / plane_rect
- hitbox 线框可视化
- **Fit Interaction Hitbox**：按可见子几何自动拟合 box hitbox

### Indicator

- Source Property 下拉选择 + Custom
- `model::partAlias` 下拉选择 + Custom
- State → Material Profile 结构化映射编辑
- 目标 model / material profile 引用校验

### Animation / Sound / Timer / Layout

Animation：
- target_model
- animation
- built-in `playing / speed`

Sound：
- sound ResourceLocation
- looping
- streamed
- static
- priority
- speed
- min_distance / max_distance
- built-in `playing / volume / pitch`

Timer：
- interval
- built-in `running / elapsed / period`

Layout：
- spacing
- columns
- 与 GFBS runtime 当前 layout 计算规则一致的预览偏移

### Bindings

结构化 Binding 管理器：

- Source / Target property address 选择
- Direct
- Map（逐项 key/value 编辑）
- Range
- Format
- 未知扩展字段保留

### Connections / Actions

结构化 Connection 管理器：

- signal source
- `set`
- `toggle`
- `emit`
- `host`
- 自定义 action ResourceLocation
- set literal 按目标 Property 类型编辑
- host optional literal payload
- 未知 action 扩展字段保留

### Workspace

**Tools → GFBS 3D-CONSOLE → Set Minecraft Project Root...**

插件会尝试从当前 Scene 路径自动寻找包含 `src/main/resources` 的 Forge/Gradle 项目根目录。无法自动找到时可以手工选择。

**Reload Linked Model Previews** 可强制重新加载 glTF 资源。

### Validation

保存前会执行编辑器侧校验，覆盖当前 GFBS format_version 1 的主要 runtime 约束，包括：

- 最大 4096 nodes
- 最大层级深度 64
- node ID 格式与全局唯一性
- ResourceLocation 字符规则
- transform finite / non-zero scale
- Property 类型与 default
- 内建 Property 不允许换类型
- model source / part / material profile
- indicator 引用
- animation target
- interaction range / hit shape
- sound distance / speed
- timer / layout
- binding source / target / map / range / format
- connection source
- `set / toggle / emit / host` action 参数

可手工执行：

**Tools → GFBS 3D-CONSOLE → Validate Scene**

## 典型工作流

```text
Blender / 模型资源
       ↓
GFBS-Main Forge project
       ↓
Blockbench + GFBS 3D-CONSOLE Studio
       ↓
打开 data/.../gfbs_console/scenes/*.json
       ↓
可视化编辑 Scene Tree / Transform / Hitbox / Properties / Logic
       ↓
Ctrl+S
       ↓
Minecraft /reload
```

## 开发 / 测试

本项目发行文件本身是未压缩、可读的 JavaScript，不需要构建步骤。

```bash
npm test
```

等价于：

```bash
node --check dist/gfbs_console_studio.js
node test/roundtrip-smoke.js
```

Smoke test 会通过 Blockbench API mock 验证 Codec/Scene 的 parse → compile round-trip，以及多个非法 Scene 的拒绝逻辑。

## 当前预览边界

编辑器的目标是 **完整 authoring**，而不是在 Blockbench 中重新实现整个 Minecraft client runtime：

- glTF：可真实加载几何/标准材质用于 linked preview。
- vanilla JSON：编辑数据完整，但没有 Forge `BakedModel` runtime，因此用代理几何表示。
- GFBS-Auralis sound：可编辑，不在 Blockbench 中实际播放 GFBS runtime 声音。
- timer / signal / binding / host action：可完整编辑与校验，不在 Blockbench 中模拟服务器权威运行时。
- GFBS-glTF animation / Minecraft shader 最终效果：应在 Minecraft dev client 中做最终验证。

这些边界不影响最终 Scene JSON 的结构化制作、保存与运行时数据表达。

## License

MIT License. Copyright (c) 2026 LytharaLab.
