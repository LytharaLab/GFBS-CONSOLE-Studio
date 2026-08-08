## 0.3.1 - 2026-08-09 — Hierarchy Transform Hotfix

- Fixed child Console nodes not following parent translation, rotation, or scale in the Blockbench viewport.
- Transform updates now walk the hierarchy parent-first and refresh the complete affected subtree on every parent transform update.
- Child preview objects are defensively reattached to the correct parent preview object; detached/orphaned elements are repaired during full refresh.
- Removed redundant transform/geometry reprocessing from the final Canvas refresh, avoiding quadratic subtree work in large scenes.
- Added a three.js r129 hierarchy regression test that verifies local child position and updated world position after moving the parent.

## 0.3.0 - 2026-08-09 — Authoring Workflow Update

- Fixed Console nodes being impossible or unreliable to select from the canvas. Blockbench only raycasts `element.mesh` non-recursively, while previous Studio versions stored all visible geometry below an empty root Group.
- Replaced the empty preview root with an invisible raycastable Mesh selection proxy for every Console node.
- Selection proxies now auto-fit direct model/text geometry, use authored interaction hit shapes, and retain a stable minimum target for logic/spatial nodes.
- Parent selection proxies explicitly exclude child Console elements so parents do not swallow child clicks.
- Added a selection outline visible in Render, Authoring, and Interaction Debug views.
- Added reference-safe Node ID rename across Indicator source/target, Animation target, Bindings, Connections, Preview overrides, and resource diagnostics.
- Reference rewriting supports legal dotted node IDs without confusing the node/property separator.
- Added reference-safe subtree duplication with globally unique IDs and copied/repaired bindings, connections, and preview overrides.
- Added “Copy Selected Subtree JSON” for fast runtime/debug handoff.
- Added “Find / Select Node” with full Outliner paths and node types.
- Added “Scene Overview / Preflight” with node-type counts, graph statistics, resource status, and validation summary.
- Added “Create Starter Console Assembly”, producing a connected panel/text/control/indicator/property/binding/connection example.
- Added dedicated quick-create actions for Knob, Lever, Slider, Indicator, Animation, Sound, Timer, Linear Layout, Grid Layout, and Surface Layout.
- Reorganized the Tools menu into Create, Structure, Logic, Preview, Node Tools, and Resources submenus instead of one long flat list.
- Added type-appropriate default interaction shapes for knobs, levers, and sliders.
- Added Resource Root removal, clearing, and priority reordering.
- Added type-specific Outliner icons.
- Expanded smoke coverage for dotted IDs and reference-safe node-data, binding, and connection rewrites.

## 0.2.2 — Vanilla Texture Pipeline Hotfix

- 修复 Blockbench 5.1.x / three.js r129 下 `TextureLoader.load()` 后立即 `clone()` 导致 face texture 永久没有 `image`、Vanilla 模型退化为纯色的问题。
- 每个 Minecraft face 现在直接持有自身异步加载的 Texture，不再 clone 未完成加载的 base texture。
- 同时支持旧版 three.js 的 `texture.encoding = THREE.sRGBEncoding` 与新版 `texture.colorSpace = THREE.SRGBColorSpace`。
- PNG 解码失败时会显式切换到 missing-texture，而不是静默显示成纯色材质。

# Changelog

## 0.2.1 - Resource Resolution Hotfix

- Fixed Render mode becoming visually worse than 0.1.x when Minecraft vanilla assets were unavailable.
- Added approximate solid-block fallback for unresolved simple `minecraft:` vanilla model IDs instead of magenta missing-model markers in Render mode.
- Expanded local Minecraft 1.20.1 asset JAR discovery across launcher and ForgeGradle/Gradle cache layouts.
- Candidate JARs are now validated for actual `assets/minecraft` content before use.
- Persist selected Minecraft asset source and Resource Roots across projects.
- Added first-load asset resolution guidance and richer resource-source diagnostics.
- Existing JSON round-trip, preview runtime, interaction simulation, glTF preview and validation behavior retained.


## 0.2.0 - 2026-08-08 — Visual Studio Update

Major visual-editor rewrite.

- Replaced the default debug-wireframe scene view with a clean Render View.
- Added Render / Authoring / Interaction Debug view modes.
- Helpers are hidden by default and selection-scoped in Authoring mode.
- Replaced the `vanilla_json` 1-block proxy with a real Minecraft Java model preview renderer.
- Added parent model inheritance, texture variables, elements/faces, UVs, face rotation and element rotation.
- Added generated-item layer preview.
- Added project resources, resource-pack roots, Minecraft asset directories and Minecraft client JAR resource sources.
- Added a lightweight ZIP/JAR reader and Minecraft 1.20.1 asset auto-detection.
- Improved glTF linked preview and preserved full hierarchy/material preview.
- Added Preview Runtime property defaults and overrides.
- Added preview Binding evaluation for direct/map/range/format bindings.
- Added Indicator -> part alias -> material profile live preview.
- Added PBR/unlit/neon/fullbright/visible/alpha/emissive profile approximation in Blockbench.
- Added glTF animation preview driven by Animation node `playing` / `speed` state.
- Added local interaction simulation for press/release/activate/scroll/drag lifecycle.
- Added local execution of scene `set`, `toggle`, and `emit` actions; host/custom actions are surfaced as external actions instead of executed.
- Added quick-create actions for Minecraft model, glTF model, text, common controls and empty Node3D.
- Changed generic Add Node default from invisible `node_3d` to `model`.
- Added resolved Preview Runtime state inspector.
- Preview-only editor state is kept out of Scene JSON.
- Expanded smoke tests to cover preview bindings, interaction simulation, vanilla model inheritance and JAR resource reading.

## 0.1.0 - 2026-08-08

Initial authoring release for GFBS-Main 3D-CONSOLE `format_version: 1`.

- Custom Blockbench model format and JSON codec.
- Direct Scene JSON open/save/Save As workflow.
- Hierarchical GFBS Console outliner nodes and local transform preview.
- Built-in and third-party node authoring.
- Scene/node property editors.
- Binding and connection/action editors.
- Interaction shape editor and hitbox fitting.
- Model source, glTF linked preview, part aliases and material profiles.
- Text, indicator, animation, sound, timer and layout authoring.
- Forge project workspace detection.
- Runtime-oriented validation and headless round-trip smoke tests.
