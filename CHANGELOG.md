## 0.3.8 - 2026-08-09 — Forced Runtime Unihex Completion

- Fixed the Blockbench-specific chain where a valid external `minecraft:default` definition contains bitmap providers but omits Unihex. Because the JSON was valid, ordinary resource fallback never ran and the exact rasterizer emitted missing-glyph boxes.
- The editor now treats the canonical Minecraft 1.20.1 Unihex provider as a mandatory completion layer for `minecraft:default`, appending it whenever Blockbench's resolved provider chain lacks one.
- Resource-pack providers keep priority; the forced Unihex provider is only the final Unicode coverage layer.
- Even if Blockbench exposes a malformed/partial Unihex provider, unresolved code points are queried directly against the bundled canonical archive before the missing-glyph renderer can run.
- Added a regression scene whose externally resolved default font is deliberately valid but bitmap-only, then verified that real Canvas rendering still produces the correct Chinese glyph width and pixels.

## 0.3.7 - 2026-08-09 — Complete Default Font Pack

- Fixed the remaining failure mode where `unifont.zip` was available but the default font JSON chain or one of its bitmap atlases failed first, leaving the initial 8px browser-monospace canvas permanently visible.
- Embedded the complete Minecraft 1.20.1 default font resource group: `default.json`, all three referenced include definitions, the ASCII/accented/non-Latin bitmap atlases, and the original Unihex archive.
- Font JSON parsing, PNG decoding and Unihex archive parsing now retry the bundled byte-exact resources when an external source is absent or invalid.
- Removed the visible system-font placeholder; text remains transparent only while the exact Minecraft raster is prepared.
- Added full no-Minecraft-install provider-chain and asset-integrity regression coverage.

## 0.3.6 - 2026-08-09 — Guaranteed CJK Font Source

- Added the unmodified Minecraft 1.20.1 GNU Unifont archive as the final source of the existing Minecraft font-provider chain.
- Studio still prefers `unifont.zip` resolved through the selected client JAR and its resource installation; if that referenced object is unavailable, the exact bundled archive is used instead of a system-font fallback or missing-glyph boxes.
- Added byte-integrity and no-launcher-assets regression tests for the bundled archive and real Chinese glyphs.
- Added the upstream GNU Unifont license and third-party notice.

## 0.3.5 - 2026-08-09 — Client-JAR Anchored Font Resolution

- The selected Minecraft client JAR is now the authoritative anchor for resolving its referenced font resources.
- Fixed portable and third-party launcher layouts where the JAR is nested more than five levels below the shared `assets/indexes` + `assets/objects` store.
- Studio now walks the JAR's complete ancestor chain and feeds the matching launcher object store into the same resource chain used by models, textures and fonts.
- Added a real Minecraft 1.20.1 regression case for a deeply nested portable-launcher JAR and its Unihex Chinese glyph data.

## 0.3.4 - 2026-08-09 — Launcher Asset Store / CJK Fix

- Fixed Minecraft 1.20.1 CJK text turning into rows of white missing-glyph boxes even though the Latin bitmap font loaded correctly.
- Added support for the launcher asset-store layout (`assets/indexes/*.json` + hashed `assets/objects/<prefix>/<sha1>`), which is where `minecraft/font/unifont.zip` may live even when the selected client/Forge JAR contains `default.json` and `ascii.png`.
- Standard Minecraft Launcher, CurseForge, Prism Launcher and MultiMC asset stores are now auto-detected and appended as supplemental resource sources alongside the selected client JAR.
- **Set Minecraft Assets Directory...** now accepts both an unpacked `assets/minecraft` tree and a launcher `indexes/` + `objects/` asset store.
- If a declared Unihex/bitmap provider cannot be loaded and the text needs one of its glyphs, Studio now keeps the readable system-font fallback and reports the exact missing provider instead of silently drawing fake boxes.
- Added regression coverage for launcher index resolution, hashed-object reads, the real 1.20.1 provider chain, the real `unifont.zip`, Chinese U+4E2D metrics, and real Unihex resolution through a launcher-style asset index.

## 0.3.3 - 2026-08-09 — Minecraft Font Parity Hotfix

- Replaced browser `monospace` text previews and fixed-width estimates with the Minecraft 1.20.1 default font provider pipeline.
- Studio now reads `assets/minecraft/font/default.json`, expands reference providers, and uses the same bitmap glyph atlases, per-glyph advances, ascent, and 9-pixel line height as the game.
- Added the Minecraft 1.20.1 `unihex` pipeline: Studio expands `minecraft:include/unifont`, reads `font/unifont.zip`, applies `size_overrides`, and renders CJK glyphs at the same 2x oversample and logical advances as the game. Legacy Unicode pages remain supported for resource-pack compatibility.
- Text geometry is resized after the exact glyph atlas is ready, preserving `pixel_scale` while making Blockbench placement match the runtime.
- Font textures use nearest-neighbor sampling and a 2x internal raster so 16px Unifont strokes survive the 8/9px logical font grid. Missing Minecraft font resources now produce an explicit resource warning and a temporary system-font fallback instead of silently pretending the preview is exact.
- Added regression coverage for font reference expansion and Minecraft bitmap/legacy-Unicode advance calculations.

## 0.3.2 - 2026-08-09 — Console Reparenting Hotfix

- Fixed `model`, `text`, and other Console nodes not becoming children when dropped onto a `node_3d` or other Console node in the Outliner.
- Console nodes now explicitly advertise Blockbench's class-level parent/drop-target capability in addition to their existing parent behavior and child-type rules.
- Added **Move to Console Parent...** to the node context menu and Navigate / Structure menu, with multi-selection, cycle prevention, Scene-root protection, and an optional keep-world-transform mode.
- Removed Blockbench's native Group-only controls from the Console-node context menu so **Move to Group** is no longer presented as if it could target GFBS nodes.
- Added regression coverage for parent/drop-target registration, direct hierarchy mutation, old-parent cleanup, cycle rejection, and world-transform preservation.

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
