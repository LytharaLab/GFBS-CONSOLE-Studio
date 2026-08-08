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
