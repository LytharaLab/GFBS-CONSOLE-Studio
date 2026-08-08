# GFBS 3D-CONSOLE Studio 0.2.1

**GFBS 3D-CONSOLE Studio** 是 LytharaLab 为 GFBS-Main / 3D-CONSOLE 制作的 Blockbench Desktop 可视化 Scene 编辑器。

它直接打开和保存：

```text
data/<namespace>/gfbs_console/scenes/*.json
```

GFBS Scene JSON 始终是 source of truth；不会要求 `.bbmodel` 中间格式。

0.2.0 的目标不再只是“把 JSON 画成一堆代理框”，而是让 Blockbench 真正承担 **3D-CONSOLE Scene Visual Editor / Studio** 的职责：真实模型预览、干净 Render View、交互调试、Preview Runtime、Binding/Indicator/Material 状态预览，以及结构化逻辑编辑。

## 运行要求

- Blockbench Desktop **5.0+**
- GFBS-Main 当前 `3D-CONSOLE format_version: 1`
- 推荐把 Scene 放在标准 Forge/Gradle 项目下：

```text
<project>/src/main/resources/
```

## 安装

1. 打开 Blockbench Desktop。
2. **File → Plugins...**。
3. 选择 **Load Plugin from File**。
4. 选择 `dist/gfbs_console_studio.js`，或发布包根目录的 `gfbs_console_studio.js`。
5. 安装后会出现 **GFBS 3D-CONSOLE Scene** 格式和 **Tools → GFBS 3D-CONSOLE Studio** 菜单。

## 打开 Scene

推荐：

**File → Import → Open GFBS 3D-CONSOLE Scene...**

例如：

```text
src/main/resources/data/gfbs_main/gfbs_console/scenes/example_console.json
```

打开后：

- Outliner = Console Scene Tree
- Move / Rotate / Scale = GFBS local transform
- 16 Blockbench units = 1 Minecraft block
- Ctrl+S = 直接写回当前 GFBS Scene JSON
- File → Export → Export GFBS Scene JSON... = Save As

插件使用 GFBS Codec 的 `Project.export_path` 保存，不会把 `.bbmodel` 内容覆盖到 Scene JSON。

# Visual Editor

## 三种 View Mode

### Render

默认模式。

只显示真正有视觉意义的 Scene 内容：

- Model
- Text
- Material / Indicator preview state
- glTF animation preview

不会把所有 Node、Indicator、Sound、Interaction hitbox 全部画成蓝色 wireframe。

无法解析的模型只显示一个很小的洋红色 missing marker，而不是 1×1×1 大代理方块淹没场景。

### Authoring

显示真实场景，同时只给**当前选中节点**显示编辑辅助：

- origin
- interaction hitbox
- spatial helper
- logic helper

适合摆放、对齐、改 hitbox。

### Interaction Debug

显示真实场景，并打开所有交互/逻辑辅助信息，适合检查：

- Button / Toggle / Knob / Lever / Slider hit shape
- Sound range helper
- logic/spatial node helper

菜单：

```text
Tools
└─ GFBS 3D-CONSOLE Studio
   ├─ View Mode: Render
   ├─ View Mode: Authoring
   └─ View Mode: Interaction Debug
```

# Model Preview

## GFBS glTF

`gfbs_main:gltf`：

- 优先使用 Blockbench 当前 `THREE.GLTFLoader`
- 支持 glTF / GLB
- 保留 hierarchy / standard material
- 支持 named node / part alias 查找
- 支持 Scene Material Profile preview
- 支持 Indicator 状态驱动 profile
- 支持 Animation node 的 `playing / speed` Preview Runtime
- Blockbench 无 GLTFLoader 时保留静态 core glTF fallback reader

项目资源：

```text
source.location = gfbs_main:models/console/foo.gltf
```

解析为：

```text
src/main/resources/assets/gfbs_main/models/console/foo.gltf
```

## Vanilla / Minecraft JSON

`gfbs_main:vanilla_json` 不再只是 wireframe proxy。

0.2.0 内置 Minecraft Java model preview renderer，支持：

- `parent`
- block registry ID → `blockstates/*.json` model fallback
- texture variable inheritance，例如 `#all`
- namespace inheritance
- `elements`
- `from / to`
- six faces
- per-face texture
- UV
- face texture rotation
- element rotation
- element rotation origin
- `rescale`
- `shade: false`
- transparent texture
- `item/generated` / `layer0` 的平面预览

例如：

```json
{
  "source": {
    "adapter": "gfbs_main:vanilla_json",
    "location": "minecraft:polished_deepslate"
  }
}
```

插件会尝试解析：

```text
assets/minecraft/models/block/polished_deepslate.json
```

并递归读取它的 parent 和 textures。

### Minecraft 原版资源从哪里来？

插件按顺序搜索：

1. 当前 Forge project 的 `src/main/resources`
2. 手工添加的 Resource Pack / resource root
3. 手工指定的 Minecraft assets directory 或 client JAR
4. 自动探测 Minecraft **1.20.1** client JAR

Windows 默认会尝试：

```text
%APPDATA%\.minecraft\versions\1.20.1\1.20.1.jar
```

以及 ForgeGradle Minecraft cache。

插件内置轻量 ZIP/JAR resource reader，因此**不需要先解压 Minecraft JAR**。

相关菜单：

```text
Set Minecraft Project Root...
Auto-detect Minecraft 1.20.1 Assets
Set Minecraft Assets Directory...
Set Minecraft Client JAR...
Add Resource Pack / Resource Root...
Show Active Resource Sources
Reload All Model / Texture Previews
```

# Preview Runtime

0.2.0 新增编辑器内 Preview Runtime。

它会建立当前 Scene 的 property state：

- Scene root properties
- Node authored properties
- built-in properties
- Preview overrides

然后执行当前 Binding：

- Direct
- Map
- Range
- Format

所以例如：

```text
power_toggle.state
        ↓ binding
$root.power
        ↓ indicator
PowerLamp material profile
```

可以直接在 Blockbench 中预览。

菜单：

**Preview Runtime State...**

可以给任意已知 property 设置仅编辑器使用的 override，例如：

```text
$root.power = true
$root.mode = AUTO
output_knob.value = 0.75
scanner_animation.playing = true
```

这些 Preview override **不会写进 Scene JSON**。

**Show Resolved Preview State** 可以查看经过 Binding 后的最终属性值。

## Material Profile Preview

Model 的 `material_profiles` 会作用到真实 linked preview，并按当前 GFBS adapter 能力区分：

**GFBS glTF adapter**：

- PBR
- UNLIT
- NEON（Blockbench 近似预览）
- color
- alpha
- emissive color
- emissive strength
- neon strength
- fullbright
- visible

**vanilla_json adapter** 当前按 GFBS-Main runtime 对齐，只预览实际会生效的：

- RGB tint
- fullbright
- visible

不会在 Blockbench 中给 vanilla JSON 虚构 runtime 尚未实现的 Neon/emissive/alpha 行为。

Indicator 会根据：

```text
source property
→ mapping key
→ states
→ model::partAlias
→ material profile
```

实时决定当前 preview profile。

最终 Minecraft shader / GFBS-RP / GFBS-glTF 的光照、Bloom、Neon 结果仍以 Minecraft dev client 为准；Blockbench 预览用于 Scene authoring，不声称逐像素复刻游戏渲染器。

# Interaction Simulation

选中：

- interaction
- button
- toggle
- knob
- lever
- slider

然后使用：

```text
Simulate ACTIVATE
Simulate Interaction...
```

支持模拟：

- PRESS
- RELEASE
- ACTIVATE
- SCROLL
- DRAG_START
- DRAG
- DRAG_END

行为按照当前 GFBS `ConsoleInteractionNode` 语义实现：

- Toggle / Lever 的 ACTIVATE 切换 state
- Lever 同步 min/max value
- Knob / Slider / Lever 的 SCROLL / DRAG 更新 value
- step / min / max sanitize
- 发射对应 signal

随后 Studio 会执行 Scene connection：

- `set`
- `toggle`
- `emit`

`host` 和第三方 custom action **不会在 Blockbench 真执行**，而会记录到 simulation log，因为真实 host action 属于 Minecraft server/runtime。

# 快速添加

0.2.0 不再把“Add Node”的默认项设为一个不可见 `node_3d`。

菜单提供：

```text
Add Minecraft / Vanilla Model...
Add GFBS glTF Model...
Add Text...
Add Button...
Add Toggle...
Add Empty Node3D...
Add GFBS Console Node...
```

通用 Add Node 默认选择 `gfbs_main:model`。

例如创建一块石头：

```text
Add Minecraft / Vanilla Model...
Node ID: test_block
Resource: minecraft:stone
```

即可获得真实 Minecraft JSON 模型预览；如果找不到原版 assets，再配置 Minecraft JAR。

# Scene / Node Authoring

支持当前全部内建节点：

- node
- node_3d
- model
- text
- indicator
- animation
- sound
- timer
- linear_layout
- grid_layout
- surface_layout
- interaction
- button
- toggle
- knob
- lever
- slider

并支持第三方 ResourceLocation node type，以及 unknown JSON 字段 round-trip 保留。

支持：

- parent / child Scene Tree
- position / rotation / scale / pivot
- GFBS XYZ Euler order
- layout preview offset
- node duplication / rename / reparent（Blockbench Outliner）

# Properties / Logic

## Properties

支持：

- boolean
- integer
- long
- double
- string
- color
- vec3
- resource

以及：

- default
- sync
- save
- interpolate
- built-in property type conflict validation

## Bindings

结构化编辑：

- source / target property address
- Direct
- Map
- Range
- Format

## Connections / Actions

结构化编辑：

- signal source
- set
- toggle
- emit
- host
- custom ResourceLocation action
- typed literal value

## Model Tools

- Model Part Aliases
- glTF node name scan
- Material Profiles

## Indicator Tools

- source property picker
- model::partAlias picker
- state → profile mapping

## Interaction Tools

- box / aabb / obb
- sphere
- cylinder
- plane / plane_rect
- Fit Interaction Hitbox

# Validation

保存前自动校验当前 GFBS `format_version: 1` 的主要约束：

- max 4096 nodes
- max depth 64
- node ID 格式 / 全局唯一
- ResourceLocation 字符规则
- transform finite / non-zero scale
- property definitions / built-in type compatibility
- model source / part / material profile
- indicator target/profile
- animation target
- hit shape / control range
- sound range/speed
- timer/layout
- binding address/map/range/format
- connection signal source
- set/toggle/emit/host 参数

手工执行：

```text
Tools → GFBS 3D-CONSOLE Studio → Validate Scene
```

# 典型工作流

```text
Blender / Minecraft model resources
             ↓
GFBS-Main Forge project
             ↓
Blockbench + GFBS 3D-CONSOLE Studio
             ↓
Open data/.../gfbs_console/scenes/*.json
             ↓
Render View 检查真实视觉
Authoring View 摆放 / 对齐
Interaction Debug 检查 hitbox
Preview Runtime 调状态 / 跑 Binding / Indicator
Simulate Interaction 测局部 Scene logic
             ↓
Ctrl+S
             ↓
Minecraft /reload
             ↓
GFBS-RP / GFBS-glTF / Minecraft runtime 最终验证
```

# 测试

```bash
npm test
```

当前自动测试覆盖：

- JS syntax check
- Scene parse → compile round-trip
- unknown/known data preservation
- validation negative cases
- Preview Binding / Format evaluation
- Preview override propagation
- interaction ACTIVATE simulation
- host action simulation logging
- Vanilla model parent/texture inheritance
- Forge workspace resource resolution
- Minecraft JAR/ZIP entry reader
- 从 JAR 继承 Vanilla model geometry

## 预览边界

Studio 已经是视觉编辑器，但 Blockbench 仍不是 Minecraft client：

- Forge `BakedModel` 的所有 loader/mod extension 不可能全部在 Blockbench 原生执行；Studio 实现的是标准 Minecraft Java model JSON renderer，并保留 ResourceLocation/Scene 数据。
- GFBS-RP、Oculus/Embeddium、Minecraft light engine、GFBS-glTF 自定义 shader 的最终像素结果必须以 dev client 为准。
- GFBS-Auralis 声音数据可以编辑，但 Studio 不启动真实 Auralis source/runtime。
- `host` action 不在 Studio 执行真实机器逻辑。

这些边界不会把默认场景退化回 wireframe proxy；它们只决定“最终游戏渲染/服务器逻辑”仍需 Minecraft 验收。

## License

MIT License. Copyright (c) 2026 LytharaLab.
