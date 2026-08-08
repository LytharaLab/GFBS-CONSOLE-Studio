/*
 * GFBS 3D-CONSOLE Studio for Blockbench
 * Copyright (c) 2026 LytharaLab
 * SPDX-License-Identifier: MIT
 *
 * Target: Blockbench 5.x desktop
 * Scene format: GFBS-Main 3D-CONSOLE format_version 1
 */
(function() {
    'use strict';

    const PLUGIN_ID = 'gfbs_console_studio';
    const FORMAT_ID = 'gfbs_console_scene';
    const CODEC_ID = 'gfbs_console_scene';
    const VERSION = '0.3.1';
    const BB_UNITS_PER_BLOCK = 16;
    const MAX_DEPTH = 64;
    const MAX_NODES = 4096;
    const MIN_SELECTION_PROXY_SIZE = 2.5;
    const DEFAULT_SELECTION_PROXY_SIZE = 5;
    const SELECTION_PROXY_PADDING = 0.75;

    const BUILTIN_TYPES = [
        'gfbs_main:node',
        'gfbs_main:node_3d',
        'gfbs_main:model',
        'gfbs_main:text',
        'gfbs_main:indicator',
        'gfbs_main:animation',
        'gfbs_main:sound',
        'gfbs_main:timer',
        'gfbs_main:linear_layout',
        'gfbs_main:grid_layout',
        'gfbs_main:surface_layout',
        'gfbs_main:interaction',
        'gfbs_main:button',
        'gfbs_main:toggle',
        'gfbs_main:knob',
        'gfbs_main:lever',
        'gfbs_main:slider'
    ];

    const SPATIAL_TYPES = new Set([
        'gfbs_main:node_3d', 'gfbs_main:model', 'gfbs_main:text', 'gfbs_main:sound',
        'gfbs_main:linear_layout', 'gfbs_main:grid_layout', 'gfbs_main:surface_layout',
        'gfbs_main:interaction', 'gfbs_main:button', 'gfbs_main:toggle',
        'gfbs_main:knob', 'gfbs_main:lever', 'gfbs_main:slider'
    ]);

    const INTERACTION_TYPES = new Set([
        'gfbs_main:interaction', 'gfbs_main:button', 'gfbs_main:toggle',
        'gfbs_main:knob', 'gfbs_main:lever', 'gfbs_main:slider'
    ]);

    const LAYOUT_TYPES = new Set([
        'gfbs_main:linear_layout', 'gfbs_main:grid_layout', 'gfbs_main:surface_layout'
    ]);

    const TYPE_ICONS = {
        'gfbs_main:node': 'account_tree',
        'gfbs_main:node_3d': 'open_with',
        'gfbs_main:model': 'view_in_ar',
        'gfbs_main:text': 'text_fields',
        'gfbs_main:indicator': 'lightbulb',
        'gfbs_main:animation': 'animation',
        'gfbs_main:sound': 'volume_up',
        'gfbs_main:timer': 'timer',
        'gfbs_main:linear_layout': 'view_week',
        'gfbs_main:grid_layout': 'grid_view',
        'gfbs_main:surface_layout': 'dashboard',
        'gfbs_main:interaction': 'touch_app',
        'gfbs_main:button': 'radio_button_checked',
        'gfbs_main:toggle': 'toggle_on',
        'gfbs_main:knob': 'tune',
        'gfbs_main:lever': 'vertical_align_center',
        'gfbs_main:slider': 'linear_scale'
    };

    let format;
    let codec;
    let ConsoleNodeElement;
    let cssHandle;
    const actions = [];
    const listenerHandles = [];
    const projectStates = new Map();
    const linkedPreviewCache = new Map();
    let previewRefreshTimer = null;

    const nodeRequire = typeof require === 'function' ? require : null;
    const fs = nodeRequire ? safeRequire('fs') : null;
    const path = nodeRequire ? safeRequire('path') : null;
    const os = nodeRequire ? safeRequire('os') : null;

    const GLOBAL_SETTINGS_KEY = 'gfbs_console_studio.global.v1';

    function safeRequire(name) {
        try { return nodeRequire(name); } catch (_) { return null; }
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function finiteNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function vector3(value, fallback) {
        if (!Array.isArray(value) || value.length !== 3) return fallback.slice();
        return [finiteNumber(value[0], fallback[0]), finiteNumber(value[1], fallback[1]), finiteNumber(value[2], fallback[2])];
    }

    function pretty(value) {
        return JSON.stringify(value, null, 2);
    }

    function parseJsonObject(text, label) {
        let result;
        try {
            result = JSON.parse(text || '{}');
        } catch (error) {
            throw new Error(`${label}: JSON syntax error: ${error.message}`);
        }
        if (!result || Array.isArray(result) || typeof result !== 'object') {
            throw new Error(`${label} must be a JSON object`);
        }
        return result;
    }

    function parseJsonArray(text, label) {
        let result;
        try {
            result = JSON.parse(text || '[]');
        } catch (error) {
            throw new Error(`${label}: JSON syntax error: ${error.message}`);
        }
        if (!Array.isArray(result)) throw new Error(`${label} must be a JSON array`);
        return result;
    }

    function showError(message, detail) {
        Blockbench.showMessageBox({
            title: 'GFBS 3D-CONSOLE Studio',
            icon: 'error',
            message: String(message),
            detail: detail ? String(detail) : undefined
        });
    }

    function showInfo(message) {
        Blockbench.showQuickMessage(message, 2500);
    }

    function markDirty() {
        if (typeof Project !== 'undefined' && Project) Project.saved = false;
        const state = getState(false);
        if (state) {
            state._resolved_preview_values = null;
            state._preview_definitions = null;
        }
        if (isConsoleProject() && typeof setTimeout === 'function') {
            if (previewRefreshTimer) clearTimeout(previewRefreshTimer);
            previewRefreshTimer = setTimeout(() => {
                previewRefreshTimer = null;
                if (isConsoleProject()) refreshAllDecorations();
            }, 20);
        }
    }

    function isConsoleProject() {
        return typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID;
    }

    function loadGlobalSettings() {
        try {
            if (typeof localStorage === 'undefined') return {};
            const raw = localStorage.getItem(GLOBAL_SETTINGS_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function saveGlobalSettings(patch) {
        try {
            if (typeof localStorage === 'undefined') return;
            const current = loadGlobalSettings();
            const next = Object.assign({}, current, patch || {});
            localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(next));
        } catch (_) {}
    }

    function defaultState() {
        const globalSettings = loadGlobalSettings();
        return {
            format_version: 1,
            properties: {},
            bindings: [],
            connections: [],
            extra_root_fields: {},
            workspace_root: null,
            source_path: null,
            preview_mode: 'render',
            preview_values: {},
            resource_roots: Array.isArray(globalSettings.resource_roots) ? globalSettings.resource_roots.slice() : [],
            minecraft_asset_source: typeof globalSettings.minecraft_asset_source === 'string' ? globalSettings.minecraft_asset_source : null,
            _asset_prompted: false,
            _resource_warnings: {},
            _resolved_preview_values: null,
            _preview_definitions: null
        };
    }

    function getState(create = true) {
        if (!isConsoleProject() || !Project) return null;
        let state = projectStates.get(Project.uuid);
        if (!state && create) {
            state = defaultState();
            projectStates.set(Project.uuid, state);
        }
        return state;
    }

    function resolveWorkspaceRoot(scenePath) {
        const state = getState();
        if (state && state.workspace_root && fs && fs.existsSync(state.workspace_root)) return state.workspace_root;
        if (!path || !scenePath) return null;
        let current = path.dirname(scenePath);
        for (let i = 0; i < 12; i++) {
            const normalized = current.replace(/\\/g, '/');
            if (normalized.endsWith('/src/main/resources')) {
                return path.dirname(path.dirname(path.dirname(current)));
            }
            const candidate = path.join(current, 'src', 'main', 'resources');
            if (fs && fs.existsSync(candidate)) return current;
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
        return null;
    }

    function resourcesRoot() {
        const state = getState();
        const root = resolveWorkspaceRoot(state && state.source_path);
        if (!root || !path) return null;
        const direct = path.join(root, 'src', 'main', 'resources');
        return fs && fs.existsSync(direct) ? direct : null;
    }

    function parseResourceLocation(id) {
        if (typeof id !== 'string') return null;
        const text = id.trim();
        const index = text.indexOf(':');
        if (index <= 0 || index === text.length - 1 || text.indexOf(':', index + 1) !== -1) return null;
        const namespace = text.substring(0, index);
        const resourcePath = text.substring(index + 1);
        // Mirrors Minecraft ResourceLocation character rules closely enough to reject
        // values that ResourceLocation.tryParse/fromNamespaceAndPath would reject.
        if (!/^[a-z0-9_.-]+$/.test(namespace) || !/^[a-z0-9/._-]+$/.test(resourcePath)) return null;
        return {namespace, path: resourcePath};
    }

    function resolveAssetLocation(id) {
        const rl = parseResourceLocation(id);
        if (!rl || !path || !fs) return null;
        const relative = path.join('assets', rl.namespace, ...rl.path.split('/'));
        const directRoot = resourcesRoot();
        if (directRoot) {
            const direct = path.join(directRoot, relative);
            if (fs.existsSync(direct)) return direct;
        }
        if (typeof resourceSources === 'function') {
            for (const source of resourceSources()) {
                if (source.kind !== 'dir') continue;
                const candidate = path.join(source.root, relative);
                if (fs.existsSync(candidate)) return candidate;
            }
        }
        return directRoot ? path.join(directRoot, relative) : null;
    }

    function rgbArrayToHex(array, fallback = '#ffffff') {
        if (!Array.isArray(array) || array.length < 3) return fallback;
        const byte = n => Math.max(0, Math.min(255, Math.round(finiteNumber(n, 0) * 255)));
        return '#' + [byte(array[0]), byte(array[1]), byte(array[2])].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function hexToRgbArray(hex, alpha) {
        let text = String(hex || '#ffffff').trim().replace(/^#/, '');
        if (text.length === 3) text = text.split('').map(c => c + c).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(text)) text = 'ffffff';
        const values = [0, 2, 4].map(i => parseInt(text.substring(i, i + 2), 16) / 255);
        if (alpha !== undefined) values.push(Math.max(0, Math.min(1, finiteNumber(alpha, 1))));
        return values;
    }

    // -----------------------------
    // Visual preview / authoring runtime
    // -----------------------------

    const VIEW_MODE_RENDER = 'render';
    const VIEW_MODE_AUTHORING = 'authoring';
    const VIEW_MODE_DEBUG = 'debug';
    const previewCaches = {
        gltf: new Map(),
        vanilla: new Map(),
        texture: new Map(),
        resource: new Map(),
        zip: new Map()
    };
    const zlib = nodeRequire ? safeRequire('zlib') : null;
    let previewAnimationTimer = null;
    let previewAnimationLastTime = 0;
    let autoMinecraftCandidatesCache = null;

    function clearPreviewCaches() {
        linkedPreviewCache.clear();
        autoMinecraftCandidatesCache = null;
        for (const value of previewCaches.texture.values()) {
            if (value && typeof value === 'object' && value.isTexture && value.dispose) {
                try { value.dispose(); } catch (_) {}
            }
        }
        Object.values(previewCaches).forEach(cache => cache.clear());
    }

    function previewMode() {
        const state = getState(false);
        return state && state.preview_mode || VIEW_MODE_RENDER;
    }

    function setPreviewMode(mode) {
        if (![VIEW_MODE_RENDER, VIEW_MODE_AUTHORING, VIEW_MODE_DEBUG].includes(mode)) return;
        const state = getState();
        state.preview_mode = mode;
        refreshAllDecorations();
        showInfo(`GFBS View: ${mode === VIEW_MODE_RENDER ? 'Render' : mode === VIEW_MODE_AUTHORING ? 'Authoring' : 'Interaction Debug'}`);
    }

    function isElementSelected(element) {
        return !!(element && (element.selected || (Outliner.selected && Outliner.selected.includes(element))));
    }

    function helperShouldBeVisible(element) {
        const mode = previewMode();
        return mode === VIEW_MODE_DEBUG || (mode === VIEW_MODE_AUTHORING && isElementSelected(element));
    }

    function createWireMaterial(opacity = 0.9, color = 0x72d7ff) {
        return new THREE.LineBasicMaterial({
            color,
            transparent: opacity < 1,
            opacity,
            depthTest: true
        });
    }

    function tagDecoration(object, kind = 'visual') {
        if (!object) return object;
        object.userData.gfbsDecoration = true;
        object.userData.gfbsDecorationKind = kind;
        return object;
    }

    function tagHelper(object, kind = 'helper') {
        if (!object) return object;
        tagDecoration(object, kind);
        object.userData.gfbsHelper = true;
        return object;
    }

    function createBoxLines(size, center, opacity = 0.9, color = 0x72d7ff) {
        const sx = Math.abs(size[0]) * BB_UNITS_PER_BLOCK;
        const sy = Math.abs(size[1]) * BB_UNITS_PER_BLOCK;
        const sz = Math.abs(size[2]) * BB_UNITS_PER_BLOCK;
        const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz));
        const lines = new THREE.LineSegments(geometry, createWireMaterial(opacity, color));
        lines.position.set(center[0] * BB_UNITS_PER_BLOCK, center[1] * BB_UNITS_PER_BLOCK, center[2] * BB_UNITS_PER_BLOCK);
        return tagDecoration(lines, 'box');
    }

    function createCross(size = 2.5, color = 0x72d7ff) {
        const vertices = new Float32Array([
            -size,0,0, size,0,0,
            0,-size,0, 0,size,0,
            0,0,-size, 0,0,size
        ]);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        return tagDecoration(new THREE.LineSegments(geometry, createWireMaterial(0.9, color)), 'cross');
    }

    function parsePreviewColor(value, fallback = '#ffffff') {
        if (typeof value === 'number' && Number.isFinite(value)) {
            const unsigned = value >>> 0;
            const rgb = unsigned & 0xFFFFFF;
            const a = ((unsigned >>> 24) & 0xFF) / 255;
            return {css: '#' + rgb.toString(16).padStart(6, '0'), alpha: a};
        }
        let text = String(value == null ? fallback : value).trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{8}$/.test(text)) {
            const a = parseInt(text.substring(0, 2), 16) / 255;
            return {css: '#' + text.substring(2), alpha: a};
        }
        if (/^[0-9a-fA-F]{6}$/.test(text)) return {css: '#' + text, alpha: 1};
        return {css: fallback, alpha: 1};
    }

    function makeTextPreview(text, pixelScale = 0.01, colorValue = '#FFFFFFFF', fullbright = false) {
        const label = String(text == null ? '' : text);
        const estimatedPixelWidth = Math.max(1, label.length * 6);
        const estimatedPixelHeight = 9;
        const scale = Math.max(0.000001, finiteNumber(pixelScale, 0.01));
        const width = Math.max(0.01, estimatedPixelWidth * scale) * BB_UNITS_PER_BLOCK;
        const height = Math.max(0.01, estimatedPixelHeight * scale) * BB_UNITS_PER_BLOCK;
        const color = parsePreviewColor(colorValue);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(64, Math.min(2048, Math.ceil(estimatedPixelWidth * 8)));
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = color.alpha;
        ctx.fillStyle = color.css;
        ctx.font = '64px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.length > 256 ? label.substring(0, 255) + '…' : label, canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        if (THREE.NearestFilter !== undefined) {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.LinearFilter !== undefined ? THREE.LinearFilter : THREE.NearestFilter;
        }
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: color.alpha,
            alphaTest: 0.01,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: !fullbright
        });
        material.userData = material.userData || {};
        material.userData.gfbsDisposeMap = true;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
        mesh.renderOrder = 16;
        return tagDecoration(mesh, 'text');
    }

    function nodeData(element) {
        try { return parseJsonObject(element.gfbs_data_json || '{}', 'Node data'); }
        catch (_) { return {}; }
    }

    function nodeProperties(element) {
        try { return parseJsonObject(element.gfbs_properties_json || '{}', 'Node properties'); }
        catch (_) { return {}; }
    }

    function interactionObject(data) {
        if (data && data.interaction && typeof data.interaction === 'object') return data.interaction;
        return data || {};
    }

    function createHitShapePreview(element) {
        const data = nodeData(element);
        const interaction = interactionObject(data);
        const shape = interaction.shape;
        if (!shape || typeof shape !== 'object') return null;
        const center = vector3(shape.center, [0, 0, 0]);
        const type = String(shape.type || 'box').toLowerCase();
        let object;
        if (type === 'box' || type === 'aabb' || type === 'obb') {
            object = createBoxLines(vector3(shape.size, [0.25, 0.25, 0.25]), center, 0.95, 0x42d9ff);
        } else if (type === 'sphere') {
            const radius = Math.max(0.001, finiteNumber(shape.radius, 0.125)) * BB_UNITS_PER_BLOCK;
            const geometry = new THREE.EdgesGeometry(new THREE.SphereGeometry(radius, 16, 10));
            object = new THREE.LineSegments(geometry, createWireMaterial(0.95, 0x42d9ff));
            object.position.set(center[0] * BB_UNITS_PER_BLOCK, center[1] * BB_UNITS_PER_BLOCK, center[2] * BB_UNITS_PER_BLOCK);
        } else if (type === 'cylinder') {
            const radius = Math.max(0.001, finiteNumber(shape.radius, 0.125)) * BB_UNITS_PER_BLOCK;
            const height = Math.max(0.001, finiteNumber(shape.height, 0.25)) * BB_UNITS_PER_BLOCK;
            const geometry = new THREE.EdgesGeometry(new THREE.CylinderGeometry(radius, radius, height, 16));
            object = new THREE.LineSegments(geometry, createWireMaterial(0.95, 0x42d9ff));
            object.position.set(center[0] * BB_UNITS_PER_BLOCK, center[1] * BB_UNITS_PER_BLOCK, center[2] * BB_UNITS_PER_BLOCK);
        } else if (type === 'plane' || type === 'plane_rect') {
            const width = Math.max(0.001, finiteNumber(shape.width, 0.25));
            const height = Math.max(0.001, finiteNumber(shape.height, 0.25));
            const thickness = Math.max(0.001, finiteNumber(shape.thickness, 0.01));
            object = createBoxLines([width, height, thickness], center, 0.95, 0x42d9ff);
        }
        if (object) {
            tagHelper(object, 'hitbox');
            object.userData.gfbsHitShape = true;
            object.visible = helperShouldBeVisible(element);
        }
        return object;
    }

    function createMissingModelMarker(element, message) {
        const renderMode = previewMode() === VIEW_MODE_RENDER;
        const box = createBoxLines(renderMode ? [0.12,0.12,0.12] : [0.25,0.25,0.25], [0, 0, 0], 0.9, 0xff3b8d);
        tagDecoration(box, 'missing_model');
        box.userData.gfbsMissingMessage = message || 'Unresolved model';
        box.userData.gfbsMissingModel = true;
        if (!renderMode) {
            box.userData.gfbsHelper = true;
            box.visible = helperShouldBeVisible(element);
        } else box.visible = true;
        return box;
    }

    function disposeMaterial(material) {
        if (!material) return;
        const list = Array.isArray(material) ? material : [material];
        list.forEach(mat => {
            if (!mat) return;
            if (mat.userData && mat.userData.gfbsDisposeMap && mat.map && mat.map.dispose) {
                try { mat.map.dispose(); } catch (_) {}
            }
            if (mat.dispose) mat.dispose();
        });
    }

    function disposeObject(object) {
        if (!object || !object.traverse) return;
        object.traverse(child => {
            if (child.geometry && child.geometry.dispose) child.geometry.dispose();
            if (child.material) disposeMaterial(child.material);
            if (child.userData && child.userData.gfbsBaseMaterial) {
                disposeMaterial(child.userData.gfbsBaseMaterial);
                delete child.userData.gfbsBaseMaterial;
            }
        });
    }

    function stopElementAnimation(element) {
        if (!element) return;
        if (element._gfbsMixer) {
            try { element._gfbsMixer.stopAllAction(); } catch (_) {}
            element._gfbsMixer = null;
        }
        element._gfbsAnimationAsset = null;
        maintainAnimationLoop();
    }

    function clearPreviewDecorations(element) {
        if (!element || !element.mesh) return;
        element._gfbsPreviewToken = (element._gfbsPreviewToken || 0) + 1;
        stopElementAnimation(element);
        const remove = element.mesh.children.filter(child => child.userData && child.userData.gfbsDecoration);
        remove.forEach(child => {
            element.mesh.remove(child);
            disposeObject(child);
        });
        element._gfbsLinkedPreview = null;
    }

    function refreshHelperVisibility(element) {
        if (!element || !element.mesh) return;
        const visible = helperShouldBeVisible(element);
        element.mesh.traverse(child => {
            if (child.userData && child.userData.gfbsSelectionOutline) child.visible = isElementSelected(element);
            else if (child.userData && child.userData.gfbsHelper) child.visible = visible;
        });
    }

    /**
     * Blockbench 5.x only raycasts element.mesh itself (non-recursively). GFBS
     * previews are linked as children, so the element root must carry geometry
     * even when that geometry is never rendered. This proxy is the canonical
     * canvas selection target for every Console node.
     */
    function createSelectionProxyMaterial() {
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        material.colorWrite = false;
        material.userData = material.userData || {};
        material.userData.gfbsSelectionMaterial = true;
        return material;
    }

    function interactionSelectionBounds(element) {
        const data = nodeData(element);
        const interaction = interactionObject(data);
        const shape = interaction && interaction.shape;
        if (!shape || typeof shape !== 'object') return null;
        const center = vector3(shape.center, [0, 0, 0]).map(value => value * BB_UNITS_PER_BLOCK);
        const type = String(shape.type || 'box').toLowerCase();
        let size;
        if (['box', 'aabb', 'obb'].includes(type)) {
            size = vector3(shape.size, [0.25, 0.25, 0.25]).map(value => Math.abs(value) * BB_UNITS_PER_BLOCK);
        } else if (type === 'sphere') {
            const diameter = Math.max(0.001, finiteNumber(shape.radius, 0.125)) * BB_UNITS_PER_BLOCK * 2;
            size = [diameter, diameter, diameter];
        } else if (type === 'cylinder') {
            const diameter = Math.max(0.001, finiteNumber(shape.radius, 0.125)) * BB_UNITS_PER_BLOCK * 2;
            const height = Math.max(0.001, finiteNumber(shape.height, 0.25)) * BB_UNITS_PER_BLOCK;
            size = [diameter, height, diameter];
        } else if (type === 'plane' || type === 'plane_rect') {
            size = [
                Math.max(0.001, finiteNumber(shape.width, 0.25)) * BB_UNITS_PER_BLOCK,
                Math.max(0.001, finiteNumber(shape.height, 0.25)) * BB_UNITS_PER_BLOCK,
                Math.max(0.001, finiteNumber(shape.thickness, 0.01)) * BB_UNITS_PER_BLOCK
            ];
        }
        if (!size) return null;
        const half = size.map(value => Math.max(MIN_SELECTION_PROXY_SIZE, value) / 2);
        return new THREE.Box3(
            new THREE.Vector3(center[0] - half[0], center[1] - half[1], center[2] - half[2]),
            new THREE.Vector3(center[0] + half[0], center[1] + half[1], center[2] + half[2])
        );
    }

    function directVisualSelectionBounds(element) {
        if (!element || !element.mesh) return null;
        element.mesh.updateMatrixWorld(true);
        const inverseRoot = new THREE.Matrix4().copy(element.mesh.matrixWorld).invert();
        const result = new THREE.Box3();
        let found = false;
        const stack = element.mesh.children.slice();
        while (stack.length) {
            const object = stack.pop();
            // A Console child has its own selection proxy. Including it here would
            // make a parent cover and steal the child's entire clickable area.
            if (object && object.isElement && object.name !== element.uuid) continue;
            if (!object || object.visible === false || (object.userData && object.userData.gfbsHelper)) continue;
            if (object.geometry) {
                if (!object.geometry.boundingBox && object.geometry.computeBoundingBox) object.geometry.computeBoundingBox();
                if (object.geometry.boundingBox) {
                    const localBox = object.geometry.boundingBox.clone();
                    const toRoot = new THREE.Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld);
                    localBox.applyMatrix4(toRoot);
                    if (!localBox.isEmpty()) {
                        result.union(localBox);
                        found = true;
                    }
                }
            }
            if (object.children && object.children.length) stack.push(...object.children);
        }
        return found ? result : null;
    }

    function updateSelectionProxy(element) {
        const mesh = element && element.mesh;
        if (!mesh || !mesh.userData || !mesh.userData.gfbsSelectionProxy) return;
        let bounds = directVisualSelectionBounds(element);
        if (!bounds && INTERACTION_TYPES.has(element.gfbs_type)) bounds = interactionSelectionBounds(element);
        if (!bounds) {
            const half = DEFAULT_SELECTION_PROXY_SIZE / 2;
            bounds = new THREE.Box3(new THREE.Vector3(-half, -half, -half), new THREE.Vector3(half, half, half));
        }
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(center);
        size.set(
            Math.max(MIN_SELECTION_PROXY_SIZE, size.x + SELECTION_PROXY_PADDING * 2),
            Math.max(MIN_SELECTION_PROXY_SIZE, size.y + SELECTION_PROXY_PADDING * 2),
            Math.max(MIN_SELECTION_PROXY_SIZE, size.z + SELECTION_PROXY_PADDING * 2)
        );
        const signature = [center.x, center.y, center.z, size.x, size.y, size.z].map(value => value.toFixed(4)).join(':');
        if (mesh.userData.gfbsSelectionSignature !== signature) {
            const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            geometry.translate(center.x, center.y, center.z);
            if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
            mesh.geometry = geometry;
            mesh.userData.gfbsSelectionSignature = signature;
        }
        let outline = mesh.children.find(child => child.userData && child.userData.gfbsSelectionOutline);
        if (!isElementSelected(element)) {
            if (outline) outline.visible = false;
            return;
        }
        if (!outline || outline.userData.gfbsSelectionSignature !== signature) {
            if (outline) { mesh.remove(outline); disposeObject(outline); }
            outline = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
                createWireMaterial(0.9, 0xffc247)
            );
            outline.position.copy(center);
            tagHelper(outline, 'selection_outline');
            outline.userData.gfbsSelectionOutline = true;
            outline.userData.gfbsSelectionSignature = signature;
            mesh.add(outline);
        }
        outline.visible = true;
    }

    // -----------------------------
    // Preview property runtime
    // -----------------------------

    function fallbackValueForType(type) {
        switch (normalizePropertyType(type)) {
            case 'boolean': return false;
            case 'integer': case 'long': case 'double': return 0;
            case 'string': return '';
            case 'color': return '#FFFFFFFF';
            case 'vec3': return [0, 0, 0];
            case 'resource': return 'minecraft:air';
            default: return '';
        }
    }

    function builtinPropertyDefinitionsForPreview(element) {
        const result = {};
        const type = element.gfbs_type;
        const data = nodeData(element);
        if (SPATIAL_TYPES.has(type) || element.gfbs_spatial) {
            result.visible = {type: 'boolean', default: true};
            result.enabled = {type: 'boolean', default: true};
        }
        if (type === 'gfbs_main:text') {
            result.text = {type: 'string', default: data.text !== undefined ? String(data.text) : ''};
            result.color = {type: 'color', default: '#FFFFFFFF'};
            result.fullbright = {type: 'boolean', default: false};
        } else if (type === 'gfbs_main:model') {
            result.alpha = {type: 'double', default: 1.0};
        } else if (INTERACTION_TYPES.has(type)) {
            result.state = {type: 'boolean', default: false};
            result.value = {type: 'double', default: 0.0};
        } else if (type === 'gfbs_main:animation') {
            result.playing = {type: 'boolean', default: false};
            result.speed = {type: 'double', default: 1.0};
        } else if (type === 'gfbs_main:sound') {
            result.playing = {type: 'boolean', default: false};
            result.volume = {type: 'double', default: 1.0};
            result.pitch = {type: 'double', default: 1.0};
        } else if (type === 'gfbs_main:timer') {
            result.running = {type: 'boolean', default: true};
            result.elapsed = {type: 'long', default: 0};
            result.period = {type: 'long', default: 20};
        }
        return result;
    }

    function mergedPreviewDefinitions(element) {
        const result = builtinPropertyDefinitionsForPreview(element);
        for (const [name, def] of Object.entries(nodeProperties(element))) {
            result[name] = Object.assign({}, result[name] || {}, clone(def));
        }
        return result;
    }

    function allPreviewDefinitions() {
        const state = getState();
        const defs = {};
        for (const [name, def] of Object.entries(state.properties || {})) defs[`$root.${name}`] = clone(def);
        ConsoleNodeElement.all.forEach(element => {
            const local = mergedPreviewDefinitions(element);
            Object.entries(local).forEach(([name, def]) => defs[`${element.name}.${name}`] = def);
        });
        return defs;
    }

    function previewDefaultValue(def) {
        if (def && Object.prototype.hasOwnProperty.call(def, 'default')) return clone(def.default);
        return fallbackValueForType(def && def.type);
    }

    function previewMappingKey(value, type) {
        const normalized = normalizePropertyType(type);
        if (normalized === 'boolean') return value ? 'true' : 'false';
        if (normalized === 'color') {
            if (typeof value === 'number') return String(value >>> 0);
            const parsed = parsePreviewColor(value);
            const hex = parsed.css.substring(1);
            const argb = ((Math.round(parsed.alpha * 255) << 24) >>> 0) | parseInt(hex, 16);
            return String(argb >>> 0);
        }
        if (normalized === 'vec3' && Array.isArray(value)) return value.map(v => Number(v)).join(',');
        return String(value);
    }

    function coercePreviewValue(value, targetType) {
        const type = normalizePropertyType(targetType);
        if (type === 'string') return String(value);
        if (type === 'boolean') return typeof value === 'string' ? value.toLowerCase() === 'true' : !!value;
        if (type === 'integer' || type === 'long') return Math.round(Number(value));
        if (type === 'double') return Number(value);
        if (type === 'vec3') return vector3(value, [0, 0, 0]);
        if (type === 'resource') return String(value);
        if (type === 'color') return value;
        return clone(value);
    }

    function javaLikeFormat(formatText, value) {
        const sentinel = '\u0000GFBS_PERCENT\u0000';
        let text = String(formatText || '').replace(/%%/g, sentinel);
        text = text.replace(/%([0 ]?)(\d+)?(?:\.(\d+))?([sdf])/g, (_, flag, widthText, precisionText, kind) => {
            let output;
            if (kind === 's') output = String(value);
            else if (kind === 'd') output = String(Math.round(Number(value)));
            else {
                const precision = precisionText === undefined ? 6 : Math.max(0, Number(precisionText));
                output = Number(value).toFixed(precision);
            }
            const width = widthText ? Number(widthText) : 0;
            if (width > output.length) output = (flag === '0' ? '0' : ' ').repeat(width - output.length) + output;
            return output;
        });
        return text.replace(new RegExp(sentinel, 'g'), '%');
    }

    function applyPreviewBinding(binding, values, defs) {
        if (!binding || !binding.source || !binding.target || !Object.prototype.hasOwnProperty.call(values, binding.source)) return false;
        let value = clone(values[binding.source]);
        const sourceDef = defs[binding.source] || {};
        const targetDef = defs[binding.target] || {};
        let mapped = false;
        if (binding.map && typeof binding.map === 'object') {
            const key = previewMappingKey(value, sourceDef.type);
            if (Object.prototype.hasOwnProperty.call(binding.map, key)) {
                value = clone(binding.map[key]);
                mapped = true;
            }
        }
        if (!mapped && binding.range && typeof binding.range === 'object') {
            const r = binding.range;
            const inputMin = Number(r.input_min), inputMax = Number(r.input_max);
            const outputMin = Number(r.output_min), outputMax = Number(r.output_max);
            const denominator = inputMax - inputMin;
            let fraction = Math.abs(denominator) < 1e-12 ? 0 : (Number(value) - inputMin) / denominator;
            fraction = Math.max(0, Math.min(1, fraction));
            value = outputMin + fraction * (outputMax - outputMin);
        }
        if (binding.format !== undefined) value = javaLikeFormat(binding.format, value);
        value = coercePreviewValue(value, targetDef.type);
        const before = values[binding.target];
        const changed = JSON.stringify(before) !== JSON.stringify(value);
        values[binding.target] = value;
        return changed;
    }

    function resolvePreviewValues() {
        const state = getState();
        const defs = allPreviewDefinitions();
        const values = {};
        Object.entries(defs).forEach(([address, def]) => values[address] = previewDefaultValue(def));
        Object.entries(state.preview_values || {}).forEach(([address, value]) => {
            if (defs[address]) values[address] = coercePreviewValue(clone(value), defs[address].type);
        });
        let propagations = 0;
        for (let round = 0; round < 64; round++) {
            let changed = false;
            for (const binding of (state.bindings || [])) {
                if (++propagations > 256) break;
                changed = applyPreviewBinding(binding, values, defs) || changed;
            }
            if (!changed || propagations > 256) break;
        }
        state._resolved_preview_values = values;
        state._preview_definitions = defs;
        return values;
    }

    function previewValue(address, fallback) {
        const state = getState(false);
        if (!state) return fallback;
        const values = state._resolved_preview_values || resolvePreviewValues();
        return Object.prototype.hasOwnProperty.call(values, address) ? values[address] : fallback;
    }

    function activeProfilesForModel(modelElement) {
        const modelData = nodeData(modelElement);
        const profiles = modelData.material_profiles && typeof modelData.material_profiles === 'object' ? modelData.material_profiles : {};
        const active = new Map();
        ConsoleNodeElement.all.forEach(indicator => {
            if (indicator.gfbs_type !== 'gfbs_main:indicator') return;
            const data = nodeData(indicator);
            const target = String(data.target || '');
            const separator = target.indexOf('::');
            if (separator <= 0 || target.substring(0, separator) !== modelElement.name) return;
            const alias = target.substring(separator + 2);
            const def = propertyDefinitionForAddress(data.source) || {};
            const sourceValue = previewValue(data.source, null);
            const key = previewMappingKey(sourceValue, def.type);
            const profileName = data.states && Object.prototype.hasOwnProperty.call(data.states, key) ? data.states[key] : null;
            if (profileName && profiles[profileName]) active.set(alias, profiles[profileName]);
        });
        return active;
    }

    function cloneMaterial(material) {
        if (Array.isArray(material)) return material.map(cloneMaterial);
        return material && material.clone ? material.clone() : material;
    }

    function captureBaseMaterials(root) {
        root.traverse(object => {
            object.userData.gfbsBaseVisible = object.visible !== false;
            if (object.material) object.userData.gfbsBaseMaterial = cloneMaterial(object.material);
        });
    }

    function restoreBaseMaterials(root) {
        root.traverse(object => {
            if (object.userData && Object.prototype.hasOwnProperty.call(object.userData, 'gfbsBaseVisible')) {
                object.visible = object.userData.gfbsBaseVisible !== false;
            }
            if (object.userData && object.userData.gfbsBaseMaterial) {
                if (object.material && object.material !== object.userData.gfbsBaseMaterial) disposeMaterial(object.material);
                object.material = cloneMaterial(object.userData.gfbsBaseMaterial);
            }
        });
    }

    function findPartTargets(root, partPath) {
        const wanted = String(partPath || '/');
        if (wanted === '/' || wanted === '') return [root];
        const normalized = wanted.replace(/^\/+|\/+$/g, '');
        const byPath = [];
        const byName = [];
        function visit(object, prefix) {
            const name = object.name || '';
            const current = name ? (prefix ? `${prefix}/${name}` : name) : prefix;
            object.userData.gfbsResolvedPath = current;
            if (current === normalized || current.endsWith('/' + normalized)) byPath.push(object);
            if (name === normalized || name === wanted) byName.push(object);
            object.children.forEach(child => visit(child, current));
        }
        visit(root, '');
        return byPath.length ? byPath : byName;
    }

    function profileMaterial(base, profile) {
        const color = Array.isArray(profile.color) ? profile.color : [1, 1, 1, 1];
        const emissive = Array.isArray(profile.emissive_color) ? profile.emissive_color : [0, 0, 0, 1];
        const alpha = Math.max(0, Math.min(1, finiteNumber(profile.alpha, color.length > 3 ? color[3] : 1)));
        const shading = String(profile.shading || 'pbr').toLowerCase();
        const common = {
            map: base && base.map || null,
            color: new THREE.Color(finiteNumber(color[0],1), finiteNumber(color[1],1), finiteNumber(color[2],1)),
            transparent: alpha < 0.999 || !!(base && base.transparent),
            opacity: alpha,
            side: base && base.side !== undefined ? base.side : THREE.FrontSide,
            alphaTest: base && base.alphaTest || 0,
            depthWrite: alpha >= 0.999
        };
        let material;
        if (shading === 'unlit' || shading === 'neon' || profile.fullbright) {
            if (shading === 'neon') {
                const strength = Math.max(0, finiteNumber(profile.neon_strength, 1));
                common.color = new THREE.Color(
                    Math.min(1, finiteNumber(color[0],1) + finiteNumber(emissive[0],0) * strength * 0.25),
                    Math.min(1, finiteNumber(color[1],1) + finiteNumber(emissive[1],0) * strength * 0.25),
                    Math.min(1, finiteNumber(color[2],1) + finiteNumber(emissive[2],0) * strength * 0.25)
                );
            }
            material = new THREE.MeshBasicMaterial(common);
        } else {
            material = new THREE.MeshStandardMaterial(Object.assign({}, common, {
                roughness: base && base.roughness !== undefined ? base.roughness : 0.85,
                metalness: base && base.metalness !== undefined ? base.metalness : 0,
                normalMap: base && base.normalMap || null,
                metalnessMap: base && base.metalnessMap || null,
                roughnessMap: base && base.roughnessMap || null,
                emissiveMap: base && base.emissiveMap || null,
                emissive: new THREE.Color(finiteNumber(emissive[0],0), finiteNumber(emissive[1],0), finiteNumber(emissive[2],0)),
                emissiveIntensity: Math.max(0, finiteNumber(profile.emissive_strength, 0))
            }));
        }
        return material;
    }

    function applyProfileToTarget(target, profile) {
        const visible = profile.visible !== false;
        target.visible = visible;
        target.traverse(object => {
            if (object !== target && !visible) object.visible = false;
            if (!object.material) return;
            const bases = Array.isArray(object.material) ? object.material : [object.material];
            const replaced = bases.map(base => profileMaterial(base, profile));
            disposeMaterial(object.material);
            object.material = Array.isArray(object.material) ? replaced : replaced[0];
        });
    }

    function applyVanillaRuntimeProfile(root, profile) {
        if (!profile) return;
        root.visible = root.visible && profile.visible !== false;
        const color = Array.isArray(profile.color) ? profile.color : [1,1,1,1];
        root.traverse(object => {
            if (!object.material) return;
            const bases = Array.isArray(object.material) ? object.material : [object.material];
            const replaced = bases.map(base => {
                if (profile.fullbright) {
                    return new THREE.MeshBasicMaterial({
                        map: base && base.map || null,
                        color: new THREE.Color(finiteNumber(color[0],1),finiteNumber(color[1],1),finiteNumber(color[2],1)),
                        transparent: !!(base && base.transparent),
                        opacity: base && base.opacity !== undefined ? base.opacity : 1,
                        alphaTest: base && base.alphaTest || 0,
                        side: base && base.side !== undefined ? base.side : THREE.FrontSide
                    });
                }
                const material = base && base.clone ? base.clone() : base;
                if (material && material.color) material.color.setRGB(finiteNumber(color[0],1),finiteNumber(color[1],1),finiteNumber(color[2],1));
                return material;
            });
            disposeMaterial(object.material);
            object.material = Array.isArray(object.material) ? replaced : replaced[0];
        });
    }

    function applyModelPreviewState(element) {
        const root = element && element._gfbsLinkedPreview;
        if (!root) return;
        restoreBaseMaterials(root);
        const nodeVisible = previewValue(`${element.name}.visible`, true) !== false;
        root.visible = nodeVisible;
        const data = nodeData(element);
        const source = data.source || {};
        const aliases = data.parts && typeof data.parts === 'object' ? data.parts : {};
        const active = activeProfilesForModel(element);
        if (source.adapter === 'gfbs_main:vanilla_json') {
            let wholeProfile = null;
            for (const [alias, profile] of active.entries()) {
                const resolved = Object.prototype.hasOwnProperty.call(aliases, alias) ? aliases[alias] : alias;
                if (resolved === '/') wholeProfile = profile;
            }
            if (wholeProfile) applyVanillaRuntimeProfile(root, wholeProfile);
        } else {
            for (const [alias, profile] of active.entries()) {
                const resolved = Object.prototype.hasOwnProperty.call(aliases, alias) ? aliases[alias] : alias;
                findPartTargets(root, resolved).forEach(target => applyProfileToTarget(target, profile));
            }
            const alpha = Math.max(0, Math.min(1, finiteNumber(previewValue(`${element.name}.alpha`, 1), 1)));
            root.traverse(object => {
                if (!object.material) return;
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach(material => {
                    material.opacity = Math.max(0, Math.min(1, finiteNumber(material.opacity, 1) * alpha));
                    if (material.opacity < 0.999) material.transparent = true;
                    material.needsUpdate = true;
                });
            });
            applyPreviewAnimationsForModel(element);
        }
        root.visible = nodeVisible && root.visible;
    }

    function applyPreviewAnimationsForModel(element) {
        if (!element || !element._gfbsLinkedPreview || !element._gfbsAnimationAsset || !THREE.AnimationMixer) return;
        if (element._gfbsMixer) {
            try { element._gfbsMixer.stopAllAction(); } catch (_) {}
        }
        const mixer = new THREE.AnimationMixer(element._gfbsLinkedPreview);
        let any = false;
        ConsoleNodeElement.all.forEach(animationNode => {
            if (animationNode.gfbs_type !== 'gfbs_main:animation') return;
            const data = nodeData(animationNode);
            if (data.target_model !== element.name) return;
            const playing = previewValue(`${animationNode.name}.playing`, false) === true;
            if (!playing) return;
            const clips = element._gfbsAnimationAsset.animations || [];
            const clip = THREE.AnimationClip && THREE.AnimationClip.findByName ? THREE.AnimationClip.findByName(clips, data.animation) : clips.find(candidate => candidate.name === data.animation);
            if (!clip) return;
            const action = mixer.clipAction(clip);
            action.timeScale = finiteNumber(previewValue(`${animationNode.name}.speed`, 1), 1);
            if (THREE.LoopRepeat !== undefined) action.setLoop(THREE.LoopRepeat, Infinity);
            action.play();
            any = true;
        });
        element._gfbsMixer = any ? mixer : null;
        if (!any) {
            try { mixer.stopAllAction(); } catch (_) {}
        }
        maintainAnimationLoop();
    }

    function maintainAnimationLoop() {
        const any = ConsoleNodeElement && ConsoleNodeElement.all && ConsoleNodeElement.all.some(element => !!element._gfbsMixer);
        if (any && !previewAnimationTimer) {
            previewAnimationLastTime = Date.now();
            previewAnimationTimer = setInterval(() => {
                if (!isConsoleProject()) return;
                const now = Date.now();
                const dt = Math.max(0, Math.min(0.1, (now - previewAnimationLastTime) / 1000));
                previewAnimationLastTime = now;
                let updated = false;
                ConsoleNodeElement.all.forEach(element => {
                    if (element._gfbsMixer) {
                        element._gfbsMixer.update(dt);
                        updated = true;
                    }
                });
                if (updated && typeof Canvas !== 'undefined' && Canvas.updateView) Canvas.updateView({elements: ConsoleNodeElement.all});
            }, 33);
        } else if (!any && previewAnimationTimer) {
            clearInterval(previewAnimationTimer);
            previewAnimationTimer = null;
        }
    }

    // -----------------------------
    // Resource source / Minecraft JAR support
    // -----------------------------

    function normalizeResourceDirectory(chosen) {
        if (!chosen || !path || !fs) return null;
        let root = chosen;
        if (path.basename(root).toLowerCase() === 'assets') root = path.dirname(root);
        if (fs.existsSync(path.join(root, 'assets'))) return root;
        if (fs.existsSync(path.join(root, 'src', 'main', 'resources', 'assets'))) return path.join(root, 'src', 'main', 'resources');
        return null;
    }

    function scanMinecraftJarCandidates(root, maxDepth = 7, maxEntries = 5000) {
        if (!root || !fs || !path || !fs.existsSync(root)) return [];
        const found = [];
        const queue = [{dir: root, depth: 0}];
        let visited = 0;
        while (queue.length && visited < maxEntries) {
            const {dir, depth} = queue.shift();
            let entries;
            try { entries = fs.readdirSync(dir, {withFileTypes: true}); }
            catch (_) { continue; }
            visited += entries.length;
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth < maxDepth && !['node_modules','.git','logs','crash-reports','saves','screenshots'].includes(entry.name)) {
                        queue.push({dir: full, depth: depth + 1});
                    }
                    continue;
                }
                if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue;
                const normalized = full.replace(/\\/g, '/').toLowerCase();
                if (normalized.includes('1.20.1')) found.push(full);
            }
        }
        return found;
    }

    function isMinecraftClientAssetArchive(candidate) {
        if (!candidate || !fs || !fs.existsSync(candidate)) return false;
        try {
            if (!fs.statSync(candidate).isFile()) return false;
            const directory = zipDirectory(candidate);
            return !!(directory && directory.entries && directory.entries.has('assets/minecraft/models/block/cube_all.json'));
        } catch (_) { return false; }
    }

    function autoMinecraftAssetCandidates() {
        if (autoMinecraftCandidatesCache) return autoMinecraftCandidatesCache.slice();
        if (!path || !fs || typeof process === 'undefined') return [];
        const home = process.env.USERPROFILE || process.env.HOME || (os && os.homedir ? os.homedir() : '') || '';
        const appData = process.env.APPDATA || '';
        const localAppData = process.env.LOCALAPPDATA || '';
        const candidates = [];
        const direct = [
            appData && path.join(appData, '.minecraft', 'versions', '1.20.1', '1.20.1.jar'),
            home && path.join(home, '.minecraft', 'versions', '1.20.1', '1.20.1.jar'),
            home && path.join(home, 'curseforge', 'minecraft', 'Install', 'versions', '1.20.1', '1.20.1.jar')
        ].filter(Boolean);
        candidates.push(...direct);

        const scanRoots = [
            appData && path.join(appData, '.minecraft', 'versions'),
            home && path.join(home, '.minecraft', 'versions'),
            appData && path.join(appData, 'PrismLauncher', 'libraries', 'com', 'mojang', 'minecraft'),
            appData && path.join(appData, 'MultiMC', 'libraries', 'com', 'mojang', 'minecraft'),
            localAppData && path.join(localAppData, 'PrismLauncher', 'libraries', 'com', 'mojang', 'minecraft'),
            home && path.join(home, 'curseforge', 'minecraft', 'Install', 'versions'),
            home && path.join(home, '.gradle', 'caches', 'forge_gradle', 'minecraft_user_repo', 'net', 'minecraft'),
            home && path.join(home, '.gradle', 'caches', 'modules-2', 'files-2.1', 'net.minecraft')
        ].filter(Boolean);
        for (const root of scanRoots) candidates.push(...scanMinecraftJarCandidates(root));

        // A ForgeGradle project may expose a local cache or run tree near the workspace.
        const state = getState(false);
        if (state && state.workspace_root) {
            const workspaceRoots = [
                path.join(state.workspace_root, '.gradle'),
                path.join(state.workspace_root, 'run'),
                path.dirname(state.workspace_root)
            ];
            for (const root of workspaceRoots) candidates.push(...scanMinecraftJarCandidates(root, 4, 1500));
        }

        const unique = [...new Set(candidates.filter(candidate => {
            try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch (_) { return false; }
        }))];
        // Validate before exposing a candidate as a resource source. This avoids mapped/
        // slim ForgeGradle jars that contain classes but no vanilla assets.
        autoMinecraftCandidatesCache = unique.filter(isMinecraftClientAssetArchive);
        return autoMinecraftCandidatesCache.slice();
    }

    function ensureLocalMinecraftAssetSource() {
        const state = getState();
        if (!state) return null;
        const projectResources = resourcesRoot();
        if (projectResources && fs && fs.existsSync(path.join(projectResources, 'assets', 'minecraft'))) return projectResources;
        for (const root of (state.resource_roots || [])) {
            const normalized = normalizeResourceDirectory(root);
            if (normalized && fs && fs.existsSync(path.join(normalized, 'assets', 'minecraft'))) return normalized;
        }
        const selected = state.minecraft_asset_source;
        if (selected && fs && fs.existsSync(selected)) {
            try {
                if (fs.statSync(selected).isDirectory()) {
                    const normalized = normalizeResourceDirectory(selected);
                    if (normalized && fs.existsSync(path.join(normalized, 'assets', 'minecraft'))) return selected;
                } else if (isMinecraftClientAssetArchive(selected)) {
                    return selected;
                }
            } catch (_) {}
        }
        const detected = autoMinecraftAssetCandidates()[0] || null;
        if (detected) {
            state.minecraft_asset_source = detected;
            saveGlobalSettings({minecraft_asset_source: detected});
            return detected;
        }
        return null;
    }

    function hasMinecraftAssetResources() {
        if (!fs || !path) return false;
        for (const source of resourceSources()) {
            try {
                if (source.kind === 'dir' && fs.existsSync(path.join(source.root, 'assets', 'minecraft', 'models', 'block', 'cube_all.json'))) return true;
                if (source.kind === 'zip') {
                    const directory = zipDirectory(source.root);
                    if (directory && directory.entries.has('assets/minecraft/models/block/cube_all.json')) return true;
                }
            } catch (_) {}
        }
        return false;
    }

    function minecraftVanillaNodeCount() {
        if (!ConsoleNodeElement || !ConsoleNodeElement.all) return 0;
        return ConsoleNodeElement.all.filter(element => {
            if (element.gfbs_type !== 'gfbs_main:model') return false;
            const source = nodeData(element).source || {};
            return source.adapter === 'gfbs_main:vanilla_json' && String(source.location || '').startsWith('minecraft:');
        }).length;
    }

    function maybePromptForMinecraftAssets() {
        const state = getState(false);
        if (!state || state._asset_prompted || hasMinecraftAssetResources()) return;
        const count = minecraftVanillaNodeCount();
        if (!count) return;
        state._asset_prompted = true;
        Blockbench.showMessageBox({
            id:'gfbs_console_missing_mc_assets',
            title:'Minecraft 1.20.1 Preview Assets Not Found',
            message:`This scene uses ${count} minecraft: vanilla model node(s). Studio is currently using approximate solid-block previews so the scene stays spatially readable.`,
            detail:'For exact vanilla model geometry and textures, let Studio search local Minecraft/ForgeGradle installations or select a Minecraft 1.20.1 client JAR.',
            commands:{
                auto:'Search Local Minecraft / ForgeGradle',
                jar:'Select Minecraft 1.20.1 Client JAR',
                approximate:'Continue With Approximate Preview'
            }
        }, result => {
            if (result === 'auto') autoDetectMinecraftAssets();
            else if (result === 'jar') setMinecraftClientJar();
        });
    }

    function resourceSources() {
        const state = getState();
        const sources = [];
        const projectResources = resourcesRoot();
        if (projectResources) sources.push({kind: 'dir', root: projectResources, id: projectResources});
        if (Array.isArray(state.resource_roots)) {
            state.resource_roots.forEach(root => {
                const normalized = normalizeResourceDirectory(root);
                if (normalized && !sources.some(source => source.id === normalized)) sources.push({kind: 'dir', root: normalized, id: normalized});
            });
        }
        const selected = state.minecraft_asset_source;
        if (selected && fs && fs.existsSync(selected)) {
            let source;
            try {
                source = fs.statSync(selected).isDirectory()
                    ? {kind: 'dir', root: normalizeResourceDirectory(selected) || selected, id: selected}
                    : {kind: 'zip', root: selected, id: selected};
            } catch (_) {}
            if (source) sources.push(source);
        }
        if (!sources.some(source => source.kind === 'zip' || (source.kind === 'dir' && fs.existsSync(path.join(source.root, 'assets', 'minecraft'))))) {
            autoMinecraftAssetCandidates().forEach(detected => {
                if (!sources.some(source => source.id === detected)) sources.push({kind: 'zip', root: detected, id: detected, auto: true});
            });
        }
        return sources;
    }

    function zipDirectory(zipPath) {
        if (!fs || !zlib) return null;
        let stat;
        try { stat = fs.statSync(zipPath); } catch (_) { return null; }
        const cacheKey = `${zipPath}:${stat.mtimeMs}:${stat.size}`;
        if (previewCaches.zip.has(cacheKey)) return previewCaches.zip.get(cacheKey);
        const buffer = fs.readFileSync(zipPath);
        const min = Math.max(0, buffer.length - 0xFFFF - 22);
        let eocd = -1;
        for (let i = buffer.length - 22; i >= min; i--) {
            if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) return null;
        const total = buffer.readUInt16LE(eocd + 10);
        const centralOffset = buffer.readUInt32LE(eocd + 16);
        const entries = new Map();
        let offset = centralOffset;
        for (let i = 0; i < total && offset + 46 <= buffer.length; i++) {
            if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
            const method = buffer.readUInt16LE(offset + 10);
            const compressedSize = buffer.readUInt32LE(offset + 20);
            const uncompressedSize = buffer.readUInt32LE(offset + 24);
            const nameLength = buffer.readUInt16LE(offset + 28);
            const extraLength = buffer.readUInt16LE(offset + 30);
            const commentLength = buffer.readUInt16LE(offset + 32);
            const localOffset = buffer.readUInt32LE(offset + 42);
            const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
            entries.set(name, {method, compressedSize, uncompressedSize, localOffset});
            offset += 46 + nameLength + extraLength + commentLength;
        }
        const result = {buffer, entries};
        previewCaches.zip.clear();
        previewCaches.zip.set(cacheKey, result);
        return result;
    }

    function readZipEntry(zipPath, entryName) {
        const directory = zipDirectory(zipPath);
        if (!directory) return null;
        const entry = directory.entries.get(entryName.replace(/\\/g, '/'));
        if (!entry) return null;
        const {buffer} = directory;
        const offset = entry.localOffset;
        if (buffer.readUInt32LE(offset) !== 0x04034b50) return null;
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const start = offset + 30 + nameLength + extraLength;
        const compressed = buffer.subarray(start, start + entry.compressedSize);
        if (entry.method === 0) return Buffer.from(compressed);
        if (entry.method === 8) return zlib.inflateRawSync(compressed);
        return null;
    }

    function readResource(relativePath) {
        const normalized = String(relativePath || '').replace(/^\/+/, '').replace(/\\/g, '/');
        const sources = resourceSources();
        for (const source of sources) {
            const key = `${source.id}|${normalized}`;
            if (previewCaches.resource.has(key)) {
                const cached = previewCaches.resource.get(key);
                if (cached !== null) return cached;
                continue;
            }
            try {
                let bytes = null;
                if (source.kind === 'dir') {
                    const file = path.join(source.root, ...normalized.split('/'));
                    if (fs.existsSync(file) && fs.statSync(file).isFile()) bytes = fs.readFileSync(file);
                } else if (source.kind === 'zip') {
                    bytes = readZipEntry(source.root, normalized);
                }
                const result = bytes ? {bytes, source, relativePath: normalized} : null;
                previewCaches.resource.set(key, result);
                if (result) return result;
            } catch (error) {
                console.warn('[GFBS Console Studio] resource read failed', source.id, normalized, error);
                previewCaches.resource.set(key, null);
            }
        }
        return null;
    }

    function readJsonResource(relativePath) {
        const resource = readResource(relativePath);
        if (!resource) return null;
        try { return {json: JSON.parse(resource.bytes.toString('utf8')), resource}; }
        catch (error) { console.warn('[GFBS Console Studio] JSON resource parse failed', relativePath, error); return null; }
    }

    function modelResourceCandidates(resourceLocation, parentContext = false) {
        const rl = parseResourceLocation(resourceLocation);
        if (!rl) return [];
        let p = rl.path.replace(/\.json$/i, '');
        p = p.replace(/^models\//, '');
        const paths = [];
        if (p.startsWith('block/') || p.startsWith('item/') || p.startsWith('builtin/')) paths.push(`assets/${rl.namespace}/models/${p}.json`);
        else {
            paths.push(`assets/${rl.namespace}/models/${p}.json`);
            paths.push(`assets/${rl.namespace}/models/block/${p}.json`);
            paths.push(`assets/${rl.namespace}/models/item/${p}.json`);
        }
        return [...new Set(paths)];
    }

    function normalizeRlWithDefault(value, defaultNamespace) {
        const text = String(value || '').trim();
        if (!text) return null;
        return text.includes(':') ? text : `${defaultNamespace}:${text}`;
    }

    function resolveVanillaTextureReference(ref, textures, defaultNamespace, depth = 0) {
        if (depth > 16 || typeof ref !== 'string') return null;
        if (ref.startsWith('#')) {
            const next = textures[ref.substring(1)];
            return next === undefined ? null : resolveVanillaTextureReference(next, textures, defaultNamespace, depth + 1);
        }
        return normalizeRlWithDefault(ref, defaultNamespace);
    }

    function syntheticVanillaModel(resourceLocation) {
        const rl = parseResourceLocation(resourceLocation);
        if (!rl || rl.path.includes('/')) return null;
        const texture = `${rl.namespace}:block/${rl.path}`;
        const texRl = parseResourceLocation(texture);
        const texturePath = `assets/${texRl.namespace}/textures/${texRl.path}.png`;
        if (!readResource(texturePath)) return null;
        return {
            namespace: rl.namespace,
            textures: {all: texture},
            elements: [{from:[0,0,0],to:[16,16,16],faces:{
                down:{texture:'#all'},up:{texture:'#all'},north:{texture:'#all'},south:{texture:'#all'},west:{texture:'#all'},east:{texture:'#all'}
            }}]
        };
    }

    function loadVanillaModelDefinition(resourceLocation, stack = []) {
        const cacheKey = `model:${resourceLocation}`;
        if (previewCaches.vanilla.has(cacheKey)) return clone(previewCaches.vanilla.get(cacheKey));
        if (stack.includes(resourceLocation) || stack.length > 32) throw new Error(`Vanilla model parent cycle: ${stack.concat(resourceLocation).join(' -> ')}`);
        const rl = parseResourceLocation(resourceLocation);
        if (!rl) throw new Error(`Invalid model ResourceLocation ${resourceLocation}`);
        let found = null;
        for (const candidate of modelResourceCandidates(resourceLocation)) {
            const result = readJsonResource(candidate);
            if (result) { found = result.json; break; }
        }
        if (!found && !rl.path.includes('/')) {
            const blockstate = readJsonResource(`assets/${rl.namespace}/blockstates/${rl.path}.json`);
            if (blockstate && blockstate.json) {
                let modelRef = null;
                const variants = blockstate.json.variants;
                if (variants && typeof variants === 'object') {
                    const selected = variants[''] || variants.normal || variants[Object.keys(variants)[0]];
                    const entry = Array.isArray(selected) ? selected[0] : selected;
                    if (entry && entry.model) modelRef = normalizeRlWithDefault(entry.model, rl.namespace);
                }
                if (!modelRef && Array.isArray(blockstate.json.multipart)) {
                    const apply = blockstate.json.multipart.find(part => part && part.apply && (part.apply.model || (Array.isArray(part.apply) && part.apply[0] && part.apply[0].model)));
                    if (apply) {
                        const entry = Array.isArray(apply.apply) ? apply.apply[0] : apply.apply;
                        if (entry && entry.model) modelRef = normalizeRlWithDefault(entry.model, rl.namespace);
                    }
                }
                if (modelRef && modelRef !== resourceLocation) {
                    const resolved = loadVanillaModelDefinition(modelRef, stack.concat(resourceLocation));
                    previewCaches.vanilla.set(cacheKey, resolved);
                    return clone(resolved);
                }
            }
        }
        if (!found) {
            const synthetic = syntheticVanillaModel(resourceLocation);
            if (synthetic) {
                previewCaches.vanilla.set(cacheKey, synthetic);
                return clone(synthetic);
            }
            throw new Error(`Minecraft model resource not found: ${resourceLocation}`);
        }
        let merged = {namespace: rl.namespace, textures: {}, elements: undefined};
        if (found.parent && found.parent !== 'builtin/generated' && found.parent !== 'builtin/entity') {
            const parentRl = normalizeRlWithDefault(found.parent, rl.namespace);
            try { merged = loadVanillaModelDefinition(parentRl, stack.concat(resourceLocation)); }
            catch (error) {
                // Keep child-defined geometry usable even when a nonessential parent is absent.
                if (!found.elements) throw error;
                console.warn('[GFBS Console Studio] vanilla parent unavailable', parentRl, error.message);
            }
        }
        const result = Object.assign({}, merged, clone(found));
        result.namespace = rl.namespace;
        result.textures = Object.assign({}, merged.textures || {}, found.textures || {});
        if (!Object.prototype.hasOwnProperty.call(found, 'elements')) result.elements = merged.elements;
        previewCaches.vanilla.set(cacheKey, result);
        return clone(result);
    }

    function textureResourceDataUrl(resourceLocation) {
        const rl = parseResourceLocation(resourceLocation);
        if (!rl) return null;
        const key = `${rl.namespace}:${rl.path}`;
        if (previewCaches.texture.has(key)) return previewCaches.texture.get(key);
        const resource = readResource(`assets/${rl.namespace}/textures/${rl.path.replace(/\.png$/i,'')}.png`);
        if (!resource) { previewCaches.texture.set(key, null); return null; }
        const dataUrl = `data:image/png;base64,${resource.bytes.toString('base64')}`;
        previewCaches.texture.set(key, dataUrl);
        return dataUrl;
    }

    function missingTexture() {
        const key = '__missing_texture__';
        if (previewCaches.texture.has(key)) return previewCaches.texture.get(key);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f000f0'; ctx.fillRect(0,0,16,16);
        ctx.fillStyle = '#101010'; ctx.fillRect(0,0,8,8); ctx.fillRect(8,8,8,8);
        const texture = new THREE.CanvasTexture(canvas);
        if (THREE.NearestFilter !== undefined) texture.magFilter = texture.minFilter = THREE.NearestFilter;
        previewCaches.texture.set(key, texture);
        return texture;
    }

    function configureMinecraftTexture(texture) {
        if (!texture) return texture;
        if (THREE.NearestFilter !== undefined) {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
        }
        texture.flipY = false;
        // Blockbench 5.1.x currently ships three.js r129, which predates
        // Texture.colorSpace/SRGBColorSpace and uses Texture.encoding instead.
        // Keep both paths so the plugin also works on newer Blockbench builds.
        if (THREE.SRGBColorSpace !== undefined && 'colorSpace' in texture) {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else if (THREE.sRGBEncoding !== undefined && 'encoding' in texture) {
            texture.encoding = THREE.sRGBEncoding;
        }
        return texture;
    }

    function loadMinecraftFaceTexture(resourceLocation, onReady) {
        const dataUrl = textureResourceDataUrl(resourceLocation);
        if (!dataUrl || !THREE.TextureLoader) return missingTexture();
        let texture = null;
        const loader = new THREE.TextureLoader();
        texture = loader.load(
            dataUrl,
            tex => {
                configureMinecraftTexture(tex);
                tex.needsUpdate = true;
                if (typeof onReady === 'function') onReady(tex);
                if (typeof Canvas !== 'undefined' && Canvas.updateView && ConsoleNodeElement) {
                    Canvas.updateView({elements: ConsoleNodeElement.all});
                }
            },
            undefined,
            error => {
                console.warn('[GFBS Console Studio] failed to decode vanilla texture', resourceLocation, error);
                // Keep the returned Texture object (materials already reference it), but
                // populate it with the synchronous missing-texture canvas so the failure
                // is visible instead of silently degrading to a flat color.
                try {
                    const fallback = missingTexture();
                    texture.image = fallback.image;
                    texture.needsUpdate = true;
                } catch (_) {}
            }
        );
        configureMinecraftTexture(texture);
        return texture;
    }

    function defaultFaceUv(element, direction) {
        const from = vector3(element.from, [0,0,0]);
        const to = vector3(element.to, [16,16,16]);
        switch (direction) {
            case 'north': return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
            case 'south': return [from[0], 16 - to[1], to[0], 16 - from[1]];
            case 'west': return [from[2], 16 - to[1], to[2], 16 - from[1]];
            case 'east': return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
            case 'up': return [from[0], from[2], to[0], to[2]];
            case 'down': return [from[0], 16 - to[2], to[0], 16 - from[2]];
            default: return [0,0,16,16];
        }
    }

    function faceTexture(textureRl, uv, rotation) {
        // IMPORTANT: Do not clone a TextureLoader result before it has finished
        // loading. Blockbench 5.1.x uses three.js r129, where Texture.clone()
        // copies the current `image` value. TextureLoader fills `image` later, so
        // an early clone permanently keeps `undefined` and renders as a flat
        // material. Load one Texture object per face and mutate that same object.
        const texture = loadMinecraftFaceTexture(textureRl);
        if (!texture) return texture;
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        const u1 = finiteNumber(uv[0],0) / 16;
        const v1 = finiteNumber(uv[1],0) / 16;
        const u2 = finiteNumber(uv[2],16) / 16;
        const v2 = finiteNumber(uv[3],16) / 16;
        texture.repeat.set(u2-u1, v2-v1);
        texture.offset.set(u1, v1);
        if (rotation) {
            texture.center.set(0.5,0.5);
            texture.rotation = -THREE.MathUtils.degToRad(finiteNumber(rotation,0));
        }
        texture.needsUpdate = true;
        return texture;
    }

    function invisibleMaterial() {
        return new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});
    }

    function vanillaFaceMaterial(face, element, direction, model) {
        if (!face) return invisibleMaterial();
        const resolved = resolveVanillaTextureReference(face.texture, model.textures || {}, model.namespace || 'minecraft');
        const texture = resolved ? faceTexture(resolved, Array.isArray(face.uv) ? face.uv : defaultFaceUv(element, direction), face.rotation) : missingTexture();
        const Material = element.shade === false ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
        const material = new Material({map:texture,color:0xffffff,transparent:true,alphaTest:0.01,side:THREE.FrontSide});
        if (material.roughness !== undefined) material.roughness = 0.9;
        if (material.metalness !== undefined) material.metalness = 0;
        return material;
    }

    function buildVanillaElement(element, model) {
        const from = vector3(element.from, [0,0,0]);
        const to = vector3(element.to, [16,16,16]);
        const size = [Math.max(1e-5,to[0]-from[0]),Math.max(1e-5,to[1]-from[1]),Math.max(1e-5,to[2]-from[2])];
        const center = [(from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2];
        const faces = element.faces || {};
        // THREE.BoxGeometry material order: east(+X), west(-X), up(+Y), down(-Y), south(+Z), north(-Z)
        const materials = ['east','west','up','down','south','north'].map(direction => vanillaFaceMaterial(faces[direction], element, direction, model));
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]), materials);
        mesh.position.set(center[0],center[1],center[2]);
        mesh.name = element.name || 'element';
        if (!element.rotation || typeof element.rotation !== 'object') return mesh;
        const rotation = element.rotation;
        const origin = vector3(rotation.origin, [8,8,8]);
        const group = new THREE.Group();
        group.position.set(origin[0],origin[1],origin[2]);
        mesh.position.sub(group.position);
        const radians = THREE.MathUtils.degToRad(finiteNumber(rotation.angle,0));
        if (rotation.axis === 'x') group.rotation.x = radians;
        else if (rotation.axis === 'y') group.rotation.y = radians;
        else if (rotation.axis === 'z') group.rotation.z = radians;
        if (rotation.rescale) {
            const factor = 1 / Math.max(1e-6, Math.cos(Math.abs(radians)));
            if (rotation.axis === 'x') group.scale.set(1,factor,factor);
            else if (rotation.axis === 'y') group.scale.set(factor,1,factor);
            else group.scale.set(factor,factor,1);
        }
        group.add(mesh);
        return group;
    }

    function buildGeneratedItemPreview(model) {
        const layer = resolveVanillaTextureReference((model.textures || {}).layer0, model.textures || {}, model.namespace || 'minecraft');
        if (!layer) return null;
        const texture = faceTexture(layer, [0,0,16,16], 0);
        const material = new THREE.MeshBasicMaterial({map:texture,color:0xffffff,transparent:true,alphaTest:0.01,side:THREE.DoubleSide});
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16,16), material);
        mesh.position.set(8,8,8);
        mesh.name = 'generated_item';
        return mesh;
    }

    function approximateBlockColor(resourceLocation) {
        const rl = parseResourceLocation(resourceLocation);
        const id = rl ? rl.path.toLowerCase() : String(resourceLocation || '').toLowerCase();
        const named = [
            ['black',0x171717],['light_gray',0x9d9d97],['gray',0x55595d],['white',0xe8e8e8],
            ['red',0xb53a32],['orange',0xe87820],['yellow',0xf0c83e],['lime',0x70b52c],
            ['green',0x4b7e2f],['cyan',0x2b8b8b],['light_blue',0x5aa6d8],['blue',0x3d55a5],
            ['purple',0x7b45a0],['magenta',0xb44aa3],['pink',0xd98499],['brown',0x79543a]
        ];
        for (const [name,color] of named) if (id.includes(name)) return color;
        if (id.includes('iron')) return 0xd7d7d7;
        if (id.includes('gold')) return 0xf4ca43;
        if (id.includes('redstone')) return 0x9f1717;
        if (id.includes('deepslate')) return 0x4c4c50;
        if (id.includes('stone')) return 0x7e7e7e;
        return 0x6d737a;
    }

    function buildApproximateVanillaBlockPreview(resourceLocation) {
        const rl = parseResourceLocation(resourceLocation);
        // A bare registry-like block id is very commonly a full cube in 3D-CONSOLE
        // authoring. This fallback preserves spatial composition when Minecraft assets
        // are unavailable; it is explicitly marked approximate and never serialized.
        if (!rl || rl.path.includes('/')) return null;
        const material = new THREE.MeshStandardMaterial({
            color: approximateBlockColor(resourceLocation), roughness: 0.92, metalness: 0.0
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(16,16,16), material);
        mesh.position.set(8,8,8);
        mesh.name = `approx_${rl.path}`;
        const root = new THREE.Group();
        root.name = resourceLocation;
        root.userData.gfbsApproximateVanilla = true;
        root.add(mesh);
        return {scene: root, animations: [], approximate: true};
    }

    function noteResourceWarning(element, message) {
        const state = getState();
        if (!state) return;
        state._resource_warnings = state._resource_warnings || {};
        if (element && element.name) state._resource_warnings[element.name] = String(message || 'Unresolved resource');
    }

    function clearResourceWarning(element) {
        const state = getState();
        if (state && state._resource_warnings && element && element.name) delete state._resource_warnings[element.name];
    }

    function loadVanillaPreview(resourceLocation) {
        const model = loadVanillaModelDefinition(resourceLocation);
        const root = new THREE.Group();
        root.name = resourceLocation;
        const elements = Array.isArray(model.elements) ? model.elements : [];
        if (elements.length) {
            elements.forEach((element,index) => {
                const object = buildVanillaElement(element, model);
                object.name = object.name || `element_${index}`;
                root.add(object);
            });
        } else {
            const generated = buildGeneratedItemPreview(model);
            if (!generated) throw new Error(`Vanilla model ${resourceLocation} contains no previewable geometry`);
            root.add(generated);
        }
        return {scene: root, animations: []};
    }

    // -----------------------------
    // glTF linked preview
    // -----------------------------

    function cloneThreeObject(object) {
        const cloned = THREE.SkeletonUtils && typeof THREE.SkeletonUtils.clone === 'function'
            ? THREE.SkeletonUtils.clone(object) : object.clone(true);
        cloned.traverse(child => {
            if (child.geometry && child.geometry.clone) child.geometry = child.geometry.clone();
            if (child.material) child.material = cloneMaterial(child.material);
        });
        return cloned;
    }

    function attachLinkedModel(element, asset, unitScale, sourceDescription) {
        if (!element.mesh || !asset || !asset.scene) return;
        const linked = cloneThreeObject(asset.scene);
        if (unitScale !== 1) linked.scale.multiplyScalar(unitScale);
        tagDecoration(linked, 'model');
        linked.userData.gfbsLinkedModel = true;
        linked.name = linked.name || sourceDescription || element.name;
        captureBaseMaterials(linked);
        const stale = element.mesh.children.filter(child => child.userData && (child.userData.gfbsModelFallback || child.userData.gfbsLinkedModel || child.userData.gfbsMissingModel));
        stale.forEach(child => { element.mesh.remove(child); disposeObject(child); });
        element.mesh.add(linked);
        element._gfbsLinkedPreview = linked;
        element._gfbsAnimationAsset = asset;
        applyTransform(element);
        applyModelPreviewState(element);
        refreshHelperVisibility(element);
        updateSelectionProxy(element);
    }

    function requestLinkedGltfPreview(element, source) {
        if (!source || source.adapter !== 'gfbs_main:gltf' || !fs || !path || !element || !element.mesh) return;
        const filePath = resolveAssetLocation(source.location);
        if (!filePath || !fs.existsSync(filePath)) {
            const marker = createMissingModelMarker(element, `glTF not found: ${source.location}`);
            if (marker) { marker.userData.gfbsMissingModel = true; element.mesh.add(marker); }
            noteResourceWarning(element, `glTF not found: ${source.location}`);
            console.warn('[GFBS Console Studio] glTF resource not found', source.location, filePath);
            return;
        }
        const token = (element._gfbsPreviewToken || 0) + 1;
        element._gfbsPreviewToken = token;
        if (THREE && typeof THREE.GLTFLoader === 'function') {
            let promise = previewCaches.gltf.get(filePath);
            if (!promise) {
                promise = new Promise((resolve, reject) => {
                    const loader = new THREE.GLTFLoader();
                    if (loader.setPath) loader.setPath(path.dirname(filePath) + path.sep);
                    loader.load(path.basename(filePath), gltf => resolve({scene:gltf.scene,animations:gltf.animations||[]}), undefined, reject);
                });
                previewCaches.gltf.set(filePath, promise);
            }
            promise.then(asset => {
                if (!element.mesh || element._gfbsPreviewToken !== token) return;
                clearResourceWarning(element);
                attachLinkedModel(element, asset, BB_UNITS_PER_BLOCK, source.location);
            }).catch(error => {
                console.warn('[GFBS Console Studio] Blockbench GLTFLoader preview failed', filePath, error);
                const fallback = tryCreateLinkedModelPreview(element, source);
                if (fallback && element.mesh && element._gfbsPreviewToken === token) attachLinkedModel(element, {scene:fallback,animations:[]}, 1, source.location);
            });
            return;
        }
        const fallback = tryCreateLinkedModelPreview(element, source);
        if (fallback && element.mesh && element._gfbsPreviewToken === token) attachLinkedModel(element, {scene:fallback,animations:[]}, 1, source.location);
    }

    function requestVanillaModelPreview(element, source) {
        if (!source || !element || !element.mesh) return;
        const token = (element._gfbsPreviewToken || 0) + 1;
        element._gfbsPreviewToken = token;
        try {
            const cacheKey = `render:${source.location}`;
            let asset = previewCaches.vanilla.get(cacheKey);
            if (!asset) {
                asset = loadVanillaPreview(source.location);
                previewCaches.vanilla.set(cacheKey, asset);
            }
            if (!element.mesh || element._gfbsPreviewToken !== token) return;
            clearResourceWarning(element);
            attachLinkedModel(element, asset, 1, source.location);
        } catch (error) {
            console.warn('[GFBS Console Studio] vanilla model preview failed', source.location, error);
            noteResourceWarning(element, error.message);
            const approximate = buildApproximateVanillaBlockPreview(source.location);
            if (approximate) {
                attachLinkedModel(element, approximate, 1, `${source.location} [approximate]`);
                element._gfbsApproximatePreview = true;
            } else if (previewMode() !== VIEW_MODE_RENDER) {
                const marker = createMissingModelMarker(element, error.message);
                if (marker) { marker.userData.gfbsMissingModel = true; element.mesh.add(marker); }
            }
        }
    }

    function tryCreateLinkedModelPreview(element, source) {
        if (!source || source.adapter !== 'gfbs_main:gltf' || !fs || !path) return null;
        const filePath = resolveAssetLocation(source.location);
        if (!filePath || !fs.existsSync(filePath)) return null;
        try {
            const fallbackKey = 'static:' + filePath;
            let template = linkedPreviewCache.get(fallbackKey);
            if (!template) {
                template = loadGltfPreview(filePath);
                linkedPreviewCache.set(fallbackKey, template);
            }
            const cloneRoot = cloneThreeObject(template);
            cloneRoot.scale.multiplyScalar(BB_UNITS_PER_BLOCK);
            return cloneRoot;
        } catch (error) {
            console.warn('[GFBS Console Studio] glTF preview failed', filePath, error);
            return null;
        }
    }

    function loadGltfPreview(filePath) {
        const parsed = readGltf(filePath);
        const json = parsed.json;
        const buffers = parsed.buffers;
        const meshTemplates = (json.meshes || []).map(meshDef => buildGltfMesh(meshDef, json, buffers, filePath));
        const nodes = (json.nodes || []).map((nodeDef, index) => {
            const object = nodeDef.mesh !== undefined && meshTemplates[nodeDef.mesh]
                ? cloneThreeObject(meshTemplates[nodeDef.mesh]) : new THREE.Group();
            object.name = nodeDef.name || `node_${index}`;
            object.userData.gfbsPartName = object.name;
            applyGltfNodeTransform(object, nodeDef);
            return object;
        });
        (json.nodes || []).forEach((nodeDef, index) => {
            (nodeDef.children || []).forEach(childIndex => {
                if (nodes[childIndex]) nodes[index].add(nodes[childIndex]);
            });
        });
        const root = new THREE.Group();
        const sceneIndex = json.scene !== undefined ? json.scene : 0;
        const sceneDef = (json.scenes || [])[sceneIndex];
        const roots = sceneDef && Array.isArray(sceneDef.nodes)
            ? sceneDef.nodes : nodes.map((_, i) => i).filter(i => !(json.nodes || []).some(n => (n.children || []).includes(i)));
        roots.forEach(i => { if (nodes[i]) root.add(nodes[i]); });
        return root;
    }

    function readGltf(filePath) {
        const extension = path.extname(filePath).toLowerCase();
        if (extension === '.glb') {
            const bytes = fs.readFileSync(filePath);
            if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Invalid GLB magic');
            if (bytes.readUInt32LE(4) !== 2) throw new Error('Only glTF 2.0 is supported');
            let offset = 12;
            let json = null;
            const chunks = [];
            while (offset + 8 <= bytes.length) {
                const length = bytes.readUInt32LE(offset);
                const type = bytes.readUInt32LE(offset + 4);
                const data = bytes.subarray(offset + 8, offset + 8 + length);
                if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8').replace(/\0+$/g, '').trim());
                else if (type === 0x004E4942) chunks.push(data);
                offset += 8 + length;
            }
            if (!json) throw new Error('GLB JSON chunk not found');
            const buffers = (json.buffers || []).map((def, i) => def.uri ? readGltfBuffer(def.uri, filePath) : chunks[i] || chunks[0]);
            return {json, buffers};
        }
        const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const buffers = (json.buffers || []).map(def => readGltfBuffer(def.uri, filePath));
        return {json, buffers};
    }

    function readGltfBuffer(uri, filePath) {
        if (!uri) return Buffer.alloc(0);
        if (uri.startsWith('data:')) {
            const comma = uri.indexOf(',');
            const meta = uri.substring(0, comma);
            const payload = uri.substring(comma + 1);
            return Buffer.from(payload, meta.includes(';base64') ? 'base64' : 'utf8');
        }
        const decoded = decodeURIComponent(uri.replace(/^file:\/\//, ''));
        return fs.readFileSync(path.resolve(path.dirname(filePath), decoded));
    }

    const GLTF_COMPONENTS = {
        5120: {ArrayType: Int8Array, bytes: 1},
        5121: {ArrayType: Uint8Array, bytes: 1},
        5122: {ArrayType: Int16Array, bytes: 2},
        5123: {ArrayType: Uint16Array, bytes: 2},
        5125: {ArrayType: Uint32Array, bytes: 4},
        5126: {ArrayType: Float32Array, bytes: 4}
    };
    const GLTF_TYPE_SIZE = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};

    function readAccessor(json, buffers, accessorIndex) {
        const accessor = json.accessors[accessorIndex];
        const view = json.bufferViews[accessor.bufferView];
        const component = GLTF_COMPONENTS[accessor.componentType];
        if (!component) throw new Error(`Unsupported glTF component type ${accessor.componentType}`);
        const size = GLTF_TYPE_SIZE[accessor.type];
        const count = accessor.count;
        const buffer = buffers[view.buffer];
        const baseOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
        const stride = view.byteStride || component.bytes * size;
        const packed = new component.ArrayType(count * size);
        const source = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const reader = accessor.componentType === 5126 ? 'getFloat32'
            : accessor.componentType === 5125 ? 'getUint32'
            : accessor.componentType === 5123 ? 'getUint16'
            : accessor.componentType === 5122 ? 'getInt16'
            : accessor.componentType === 5121 ? 'getUint8' : 'getInt8';
        for (let i = 0; i < count; i++) {
            for (let j = 0; j < size; j++) {
                const offset = baseOffset + i * stride + j * component.bytes;
                packed[i * size + j] = component.bytes === 1 ? source[reader](offset) : source[reader](offset, true);
            }
        }
        return {array: packed, size, count, normalized: !!accessor.normalized};
    }

    function buildGltfMesh(meshDef, json, buffers, filePath) {
        const root = new THREE.Group();
        root.name = meshDef.name || 'mesh';
        (meshDef.primitives || []).forEach((primitive, index) => {
            if (primitive.mode !== undefined && primitive.mode !== 4) return;
            if (!primitive.attributes || primitive.attributes.POSITION === undefined) return;
            const geometry = new THREE.BufferGeometry();
            const positionAccessor = readAccessor(json, buffers, primitive.attributes.POSITION);
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positionAccessor.array), positionAccessor.size));
            if (primitive.attributes.NORMAL !== undefined) {
                const normal = readAccessor(json, buffers, primitive.attributes.NORMAL);
                geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normal.array), normal.size));
            }
            if (primitive.attributes.TEXCOORD_0 !== undefined) {
                const uv = readAccessor(json, buffers, primitive.attributes.TEXCOORD_0);
                geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv.array), uv.size));
            }
            if (primitive.indices !== undefined) {
                const indices = readAccessor(json, buffers, primitive.indices);
                geometry.setIndex(new THREE.BufferAttribute(indices.array, 1));
            }
            if (!geometry.attributes.normal) geometry.computeVertexNormals();
            const material = gltfMaterial(json.materials && json.materials[primitive.material], json, filePath);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `${root.name}_primitive_${index}`;
            root.add(mesh);
        });
        return root;
    }

    function gltfMaterial(def, json, filePath) {
        def = def || {};
        const pbr = def.pbrMetallicRoughness || {};
        const factor = pbr.baseColorFactor || [0.65, 0.7, 0.78, 1];
        const emissive = def.emissiveFactor || [0, 0, 0];
        const MaterialClass = def.extensions && def.extensions.KHR_materials_unlit ? THREE.MeshBasicMaterial : THREE.MeshStandardMaterial;
        const options = {
            color: new THREE.Color(factor[0], factor[1], factor[2]),
            transparent: factor[3] < 0.999 || def.alphaMode === 'BLEND',
            opacity: factor[3],
            side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide
        };
        if (MaterialClass === THREE.MeshStandardMaterial) {
            options.metalness = finiteNumber(pbr.metallicFactor, 1);
            options.roughness = finiteNumber(pbr.roughnessFactor, 1);
            options.emissive = new THREE.Color(emissive[0], emissive[1], emissive[2]);
        }
        return new MaterialClass(options);
    }

    function applyGltfNodeTransform(object, nodeDef) {
        if (Array.isArray(nodeDef.matrix) && nodeDef.matrix.length === 16) {
            object.matrix.fromArray(nodeDef.matrix);
            object.matrix.decompose(object.position, object.quaternion, object.scale);
            return;
        }
        if (Array.isArray(nodeDef.translation)) object.position.fromArray(nodeDef.translation);
        if (Array.isArray(nodeDef.rotation)) object.quaternion.fromArray(nodeDef.rotation);
        if (Array.isArray(nodeDef.scale)) object.scale.fromArray(nodeDef.scale);
    }

    function listGltfParts(filePath) {
        try {
            const parsed = readGltf(filePath);
            return (parsed.json.nodes || []).map((node, i) => node.name || `node_${i}`);
        } catch (_) { return []; }
    }

    // -----------------------------
    // Element decoration + transform
    // -----------------------------

    function updateElementDecoration(element) {
        if (!element.mesh) return;
        clearPreviewDecorations(element);
        resolvePreviewValues();
        const type = element.gfbs_type;
        const data = nodeData(element);
        const mode = previewMode();

        if (type === 'gfbs_main:model') {
            const source = data.source || {};
            if (source.adapter === 'gfbs_main:gltf') requestLinkedGltfPreview(element, source);
            else if (source.adapter === 'gfbs_main:vanilla_json') requestVanillaModelPreview(element, source);
            else {
                const marker = createMissingModelMarker(element, `No Blockbench preview adapter for ${source.adapter || '<missing>'}`);
                if (marker) { marker.userData.gfbsModelFallback = true; element.mesh.add(marker); }
            }
            if (mode !== VIEW_MODE_RENDER) {
                const origin = createCross(1.5, 0x72d7ff);
                tagHelper(origin, 'model_origin');
                origin.visible = helperShouldBeVisible(element);
                element.mesh.add(origin);
            }
        } else if (type === 'gfbs_main:text') {
            const text = previewValue(`${element.name}.text`, data.text || '');
            const color = previewValue(`${element.name}.color`, '#FFFFFFFF');
            const fullbright = previewValue(`${element.name}.fullbright`, false) === true;
            element.mesh.add(makeTextPreview(text, finiteNumber(data.pixel_scale, 0.01), color, fullbright));
            if (mode !== VIEW_MODE_RENDER) {
                const origin = createCross(1.0, 0x72d7ff); tagHelper(origin, 'text_origin'); origin.visible = helperShouldBeVisible(element); element.mesh.add(origin);
            }
        } else if (INTERACTION_TYPES.has(type)) {
            if (mode !== VIEW_MODE_RENDER) {
                const origin = createCross(1.5, 0x42d9ff); tagHelper(origin, 'interaction_origin'); origin.visible = helperShouldBeVisible(element); element.mesh.add(origin);
                const hit = createHitShapePreview(element); if (hit) element.mesh.add(hit);
            }
        } else if (type === 'gfbs_main:sound') {
            if (mode === VIEW_MODE_DEBUG || (mode === VIEW_MODE_AUTHORING && isElementSelected(element))) {
                const max = Math.min(64, Math.max(0.1, finiteNumber(data.max_distance, 32))) * BB_UNITS_PER_BLOCK;
                const radius = Math.min(max, 32);
                const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(radius, 16, 8)), createWireMaterial(0.35, 0x9d7dff));
                tagHelper(ring, 'sound'); ring.visible = helperShouldBeVisible(element); element.mesh.add(ring);
            }
        } else if (type === 'gfbs_main:indicator' || type === 'gfbs_main:animation' || type === 'gfbs_main:timer' || type === 'gfbs_main:node') {
            if (mode !== VIEW_MODE_RENDER) {
                const helper = createCross(type === 'gfbs_main:node' ? 1.0 : 1.25, type === 'gfbs_main:indicator' ? 0xffd35a : 0x72d7ff);
                tagHelper(helper, 'logic'); helper.visible = helperShouldBeVisible(element); element.mesh.add(helper);
            }
        } else if (LAYOUT_TYPES.has(type) || type === 'gfbs_main:node_3d' || element.gfbs_spatial) {
            if (mode !== VIEW_MODE_RENDER) {
                const helper = createCross(1.25, 0x72d7ff); tagHelper(helper, 'spatial'); helper.visible = helperShouldBeVisible(element); element.mesh.add(helper);
            }
        }
        updateSelectionProxy(element);
    }

    function applyTransform(element) {
        const mesh = element.mesh;
        if (!mesh) return;
        const parentElement = element.parent instanceof ConsoleNodeElement ? element.parent : null;
        const targetParent = parentElement && parentElement.mesh ? parentElement.mesh : (Project && Project.model_3d);
        if (targetParent && mesh.parent !== targetParent) targetParent.add(mesh);

        const position = vector3(element.position, [0, 0, 0]);
        const rotation = vector3(element.rotation, [0, 0, 0]);
        const scale = vector3(element.scale, [1, 1, 1]);
        const pivot = vector3(element.gfbs_pivot, [0, 0, 0]);
        const layout = layoutOffsetFor(element);
        const logicalPosition = new THREE.Vector3(
            position[0] + layout[0] * BB_UNITS_PER_BLOCK,
            position[1] + layout[1] * BB_UNITS_PER_BLOCK,
            position[2] + layout[2] * BB_UNITS_PER_BLOCK
        );
        const euler = new THREE.Euler(
            THREE.MathUtils.degToRad(rotation[0]),
            THREE.MathUtils.degToRad(rotation[1]),
            THREE.MathUtils.degToRad(rotation[2]),
            'XYZ'
        );
        const quaternion = new THREE.Quaternion().setFromEuler(euler);
        const pivotVector = new THREE.Vector3(pivot[0] * BB_UNITS_PER_BLOCK,pivot[1] * BB_UNITS_PER_BLOCK,pivot[2] * BB_UNITS_PER_BLOCK);
        const transformedPivot = pivotVector.clone().multiply(new THREE.Vector3(scale[0], scale[1], scale[2])).applyQuaternion(quaternion);
        logicalPosition.add(pivotVector).sub(transformedPivot);
        mesh.position.copy(logicalPosition);
        mesh.quaternion.copy(quaternion);
        mesh.scale.set(scale[0], scale[1], scale[2]);
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
    }

    function applyTransformTree(element, visited = new Set()) {
        if (!(element instanceof ConsoleNodeElement) || visited.has(element)) return;
        visited.add(element);
        applyTransform(element);
        (element.children || []).forEach(child => {
            if (child instanceof ConsoleNodeElement) applyTransformTree(child, visited);
        });
        if (element.mesh) element.mesh.updateMatrixWorld(true);
    }

    function layoutOffsetFor(element) {
        const parent = element.parent;
        if (!parent || parent === 'root' || !(parent instanceof ConsoleNodeElement) || !LAYOUT_TYPES.has(parent.gfbs_type)) return [0, 0, 0];
        const children = (parent.children || []).filter(child => child instanceof ConsoleNodeElement && (SPATIAL_TYPES.has(child.gfbs_type) || child.gfbs_spatial));
        const index = children.indexOf(element);
        if (index < 0) return [0, 0, 0];
        const data = nodeData(parent);
        const spacing = vector3(data.spacing, [0.1, 0.1, 0.1]);
        const columns = Math.max(1, Math.floor(finiteNumber(data.columns, 1)));
        if (parent.gfbs_type === 'gfbs_main:linear_layout') return [spacing[0] * index, spacing[1] * index, spacing[2] * index];
        const row = Math.floor(index / columns);
        return [(index % columns) * spacing[0], row * spacing[1], parent.gfbs_type === 'gfbs_main:surface_layout' ? 0 : row * spacing[2]];
    }

    function refreshAllTransforms() {
        if (!ConsoleNodeElement) return;
        const visited = new Set();
        Outliner.root.filter(element => element instanceof ConsoleNodeElement).forEach(root => applyTransformTree(root, visited));
        // Repair detached/orphaned elements defensively without updating an
        // already-visited subtree a second time.
        ConsoleNodeElement.all.forEach(element => applyTransformTree(element, visited));
        if (typeof Canvas !== 'undefined' && Canvas.updateView) Canvas.updateView({selection: true});
    }

    function refreshAllDecorations() {
        if (!ConsoleNodeElement) return;
        resolvePreviewValues();
        ConsoleNodeElement.all.forEach(updateElementDecoration);
        refreshAllTransforms();
    }

    // -----------------------------
    // Console node element
    // -----------------------------

    function registerConsoleNodeType() {
        ConsoleNodeElement = class ConsoleNodeElement extends OutlinerElement {
            constructor(data, uuid) {
                super(data || {}, uuid);
                this.children = [];
                this.isOpen = true;
                for (const key in ConsoleNodeElement.properties) {
                    ConsoleNodeElement.properties[key].reset(this);
                }
                if (data && typeof data === 'object') this.extend(data);
            }

            get origin() { return this.position; }

            extend(object) {
                for (const key in ConsoleNodeElement.properties) {
                    ConsoleNodeElement.properties[key].merge(this, object || {});
                }
                if (object && Array.isArray(object.children)) this.children = object.children;
                this.icon = TYPE_ICONS[this.gfbs_type] || (this.gfbs_spatial ? 'open_with' : 'account_tree');
                this.sanitizeName();
                return this;
            }

            getUndoCopy() {
                const copy = new ConsoleNodeElement(this);
                copy.uuid = this.uuid;
                copy.children = (this.children || []).slice();
                delete copy.parent;
                return copy;
            }

            getSaveCopy() {
                const out = {};
                for (const key in ConsoleNodeElement.properties) ConsoleNodeElement.properties[key].copy(this, out);
                out.type = 'gfbs_console_node';
                out.uuid = this.uuid;
                out.children = (this.children || []).map(child => child.uuid);
                return out;
            }

            getWorldCenter() {
                const target = new THREE.Vector3();
                if (this.mesh) this.mesh.getWorldPosition(target);
                return target;
            }
        };

        ConsoleNodeElement.behavior = {
            unique_name: true,
            movable: true,
            rotatable: true,
            scalable: true,
            parent: true,
            child_types: ['gfbs_console_node']
        };
        ConsoleNodeElement.prototype.type = 'gfbs_console_node';
        ConsoleNodeElement.prototype.title = 'GFBS Console Node';
        ConsoleNodeElement.prototype.icon = 'account_tree';
        ConsoleNodeElement.prototype.name_regex = () => 'a-zA-Z0-9_.-';
        ConsoleNodeElement.prototype.buttons = [Outliner.buttons.locked, Outliner.buttons.visibility].filter(Boolean);

        new Property(ConsoleNodeElement, 'string', 'name', {default: 'node'});
        new Property(ConsoleNodeElement, 'string', 'gfbs_type', {default: 'gfbs_main:node_3d'});
        new Property(ConsoleNodeElement, 'boolean', 'gfbs_spatial', {default: true});
        new Property(ConsoleNodeElement, 'vector', 'position', {default: [0, 0, 0]});
        new Property(ConsoleNodeElement, 'vector', 'rotation', {default: [0, 0, 0]});
        new Property(ConsoleNodeElement, 'vector', 'scale', {default: [1, 1, 1]});
        new Property(ConsoleNodeElement, 'vector', 'gfbs_pivot', {default: [0, 0, 0]});
        new Property(ConsoleNodeElement, 'string', 'gfbs_data_json', {default: '{}'});
        new Property(ConsoleNodeElement, 'string', 'gfbs_properties_json', {default: '{}'});
        new Property(ConsoleNodeElement, 'boolean', 'visibility', {default: true});

        OutlinerElement.registerType(ConsoleNodeElement, 'gfbs_console_node');

        new NodePreviewController(ConsoleNodeElement, {
            setup(element) {
                const mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(DEFAULT_SELECTION_PROXY_SIZE, DEFAULT_SELECTION_PROXY_SIZE, DEFAULT_SELECTION_PROXY_SIZE),
                    createSelectionProxyMaterial()
                );
                Project.nodes_3d[element.uuid] = mesh;
                mesh.name = element.uuid;
                mesh.type = element.type;
                mesh.isElement = true;
                mesh.userData.gfbsSelectionProxy = true;
                mesh.visible = element.visibility !== false;
                updateElementDecoration(element);
                applyTransform(element);
                updateSelectionProxy(element);
                this.dispatchEvent('setup', {element});
            },
            updateTransform(element) {
                applyTransformTree(element);
                subtreeElements(element).forEach(updateSelectionProxy);
                this.dispatchEvent('update_transform', {element});
            },
            updateGeometry(element) {
                updateElementDecoration(element);
                applyTransformTree(element);
                this.dispatchEvent('update_geometry', {element});
            },
            updateVisibility(element) {
                if (element.mesh) element.mesh.visible = element.visibility !== false;
            },
            updateSelection(element) {
                if (!element.mesh) return;
                updateSelectionProxy(element);
                refreshHelperVisibility(element);
                element.mesh.traverse(child => {
                    if (child.material && child.userData && child.userData.gfbsHitShape) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(mat => { if (mat.color) mat.color.set(isElementSelected(element) ? 0xffd15c : 0x42d9ff); });
                    }
                });
                this.dispatchEvent('update_selection', {element});
            },
            remove(element) {
                if (element.mesh) {
                    clearPreviewDecorations(element);
                    if (element.mesh.parent) element.mesh.parent.remove(element.mesh);
                    if (element.mesh.geometry && element.mesh.geometry.dispose) element.mesh.geometry.dispose();
                    if (element.mesh.material) disposeMaterial(element.mesh.material);
                }
                delete Project.nodes_3d[element.uuid];
            }
        });

        ConsoleNodeElement.prototype.menu = new Menu([
            'gfbs_console_edit_node',
            'gfbs_console_add_child',
            'gfbs_console_duplicate_subtree',
            'gfbs_console_copy_node_json',
            'gfbs_console_simulate_activate',
            'gfbs_console_simulate_interaction',
            'gfbs_console_interaction_shape',
            'gfbs_console_fit_hitbox',
            'gfbs_console_indicator_states',
            'gfbs_console_model_parts',
            'gfbs_console_material_profiles',
            '_',
            ...Outliner.control_menu_group,
            '_',
            'rename',
            'delete'
        ]);
    }

    // -----------------------------
    // Scene parse / compile
    // -----------------------------

    function validateNodeId(id) {
        return /^[a-zA-Z_][a-zA-Z0-9_.-]{0,95}$/.test(id);
    }

    function transformFromJson(json) {
        json = json || {};
        const position = vector3(json.position, [0, 0, 0]).map(v => v * BB_UNITS_PER_BLOCK);
        const scale = vector3(json.scale, [1, 1, 1]);
        const pivot = vector3(json.pivot, [0, 0, 0]);
        let rotation = vector3(json.rotation, [0, 0, 0]);
        if (Array.isArray(json.quaternion) && json.quaternion.length === 4) {
            const q = new THREE.Quaternion(
                finiteNumber(json.quaternion[0]), finiteNumber(json.quaternion[1]),
                finiteNumber(json.quaternion[2]), finiteNumber(json.quaternion[3], 1)
            ).normalize();
            const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
            rotation = [THREE.MathUtils.radToDeg(e.x), THREE.MathUtils.radToDeg(e.y), THREE.MathUtils.radToDeg(e.z)];
        }
        return {position, rotation, scale, pivot};
    }

    function createElementFromNode(node, parent, depth, seen) {
        if (depth > MAX_DEPTH) throw new Error(`Scene exceeds maximum depth ${MAX_DEPTH}`);
        if (!node || typeof node !== 'object') throw new Error('Node must be an object');
        if (!validateNodeId(node.id)) throw new Error(`Invalid node id: ${node.id}`);
        if (seen.has(node.id)) throw new Error(`Console node ids must be globally unique: ${node.id}`);
        seen.add(node.id);
        if (seen.size > MAX_NODES) throw new Error(`Scene exceeds maximum node count ${MAX_NODES}`);

        const transform = transformFromJson(node.transform);
        const data = clone(node);
        delete data.id;
        delete data.type;
        delete data.transform;
        delete data.properties;
        delete data.children;

        const element = new ConsoleNodeElement({
            name: node.id,
            gfbs_type: node.type || 'gfbs_main:node_3d',
            gfbs_spatial: SPATIAL_TYPES.has(node.type || 'gfbs_main:node_3d') || !!node.transform,
            position: transform.position,
            rotation: transform.rotation,
            scale: transform.scale,
            gfbs_pivot: transform.pivot,
            gfbs_data_json: pretty(data),
            gfbs_properties_json: pretty(node.properties || {})
        }).init();
        element.addTo(parent || 'root');
        for (const child of (node.children || [])) createElementFromNode(child, element, depth + 1, seen);
        return element;
    }

    function clearCurrentConsoleNodes() {
        if (!ConsoleNodeElement) return;
        [...ConsoleNodeElement.all].reverse().forEach(element => element.remove());
    }

    function loadSceneDocument(json, filePath) {
        if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Scene root must be a JSON object');
        const version = json.format_version === undefined ? 1 : Number(json.format_version);
        if (version !== 1) throw new Error(`Unsupported GFBS console format_version ${version}`);
        if (!json.root || typeof json.root !== 'object') throw new Error('Scene is missing root object');

        clearCurrentConsoleNodes();
        const state = getState();
        state.format_version = version;
        state.properties = clone(json.properties || {});
        state.bindings = clone(json.bindings || []);
        state.connections = clone(json.connections || []);
        state.extra_root_fields = {};
        for (const [key,value] of Object.entries(json)) {
            if (!['format_version','properties','root','bindings','connections'].includes(key)) state.extra_root_fields[key] = clone(value);
        }
        state.source_path = filePath || null;
        state.workspace_root = resolveWorkspaceRoot(filePath) || state.workspace_root || null;
        state.preview_mode = state.preview_mode || VIEW_MODE_RENDER;
        state.preview_values = {};
        state._resolved_preview_values = null;
        state._preview_definitions = null;
        state._resource_warnings = {};
        ensureLocalMinecraftAssetSource();

        createElementFromNode(json.root, 'root', 0, new Set());
        Project.name = filePath && path ? path.basename(filePath, path.extname(filePath)) : (Project.name || 'console_scene');
        if (filePath) {
            // The GFBS JSON is the format file itself, not a .bbmodel project file.
            Project.save_path = '';
            Project.export_path = filePath;
            Project.export_codec = CODEC_ID;
        }
        setTimeout(() => {
            refreshAllDecorations();
            maybePromptForMinecraftAssets();
            const validation = validateCurrentScene(false);
            if (validation.errors.length) showError(`Loaded with ${validation.errors.length} validation error(s)`, validation.errors.join('\n'));
        }, 0);
    }

    function transformToJson(element) {
        if (!element.gfbs_spatial && !SPATIAL_TYPES.has(element.gfbs_type)) return null;
        const position = vector3(element.position, [0, 0, 0]).map(v => v / BB_UNITS_PER_BLOCK);
        const rotation = vector3(element.rotation, [0, 0, 0]);
        const scale = vector3(element.scale, [1, 1, 1]);
        const pivot = vector3(element.gfbs_pivot, [0, 0, 0]);
        const out = {};
        if (position.some(v => Math.abs(v) > 1e-8)) out.position = position;
        if (rotation.some(v => Math.abs(v) > 1e-8)) out.rotation = rotation;
        if (scale.some(v => Math.abs(v - 1) > 1e-8)) out.scale = scale;
        if (pivot.some(v => Math.abs(v) > 1e-8)) out.pivot = pivot;
        return Object.keys(out).length ? out : null;
    }

    function compileNode(element, depth = 0) {
        if (depth > MAX_DEPTH) throw new Error(`Scene exceeds maximum depth ${MAX_DEPTH}`);
        const data = parseJsonObject(element.gfbs_data_json || '{}', `Node ${element.name} data`);
        const properties = parseJsonObject(element.gfbs_properties_json || '{}', `Node ${element.name} properties`);
        const out = Object.assign({}, data);
        out.id = element.name;
        out.type = element.gfbs_type || 'gfbs_main:node_3d';
        const transform = transformToJson(element);
        if (transform) out.transform = transform;
        if (Object.keys(properties).length) out.properties = properties;
        const children = (element.children || []).filter(child => child instanceof ConsoleNodeElement);
        if (children.length) out.children = children.map(child => compileNode(child, depth + 1));
        // Put structural fields first for human readability.
        const ordered = {id: out.id, type: out.type};
        if (out.transform) ordered.transform = out.transform;
        if (out.properties) ordered.properties = out.properties;
        for (const [key, value] of Object.entries(out)) {
            if (!['id','type','transform','properties','children'].includes(key)) ordered[key] = value;
        }
        if (out.children) ordered.children = out.children;
        return ordered;
    }

    function compileSceneDocument() {
        const state = getState();
        if (!state) throw new Error('Not a GFBS Console project');
        const roots = Outliner.root.filter(node => node instanceof ConsoleNodeElement);
        if (roots.length !== 1) throw new Error(`GFBS console scene must have exactly one root node; found ${roots.length}`);
        const out = {format_version: 1};
        for (const [key,value] of Object.entries(state.extra_root_fields || {})) out[key] = clone(value);
        if (Object.keys(state.properties || {}).length) out.properties = clone(state.properties);
        else out.properties = {};
        out.root = compileNode(roots[0]);
        if ((state.bindings || []).length) out.bindings = clone(state.bindings);
        if ((state.connections || []).length) out.connections = clone(state.connections);
        return out;
    }

    // -----------------------------
    // Reference-safe structural editing
    // -----------------------------

    function mappingEntries(mapping) {
        const entries = mapping instanceof Map ? Array.from(mapping.entries()) : Object.entries(mapping || {});
        return entries.filter(([from, to]) => from && to && from !== to).sort((a, b) => b[0].length - a[0].length);
    }

    function rewriteNodeId(value, mapping) {
        const text = String(value == null ? '' : value);
        const match = mappingEntries(mapping).find(([from]) => text === from);
        return match ? match[1] : text;
    }

    function rewriteQualifiedReference(value, mapping) {
        const text = String(value == null ? '' : value);
        if (!text || text.startsWith('$root.')) return text;
        for (const [from, to] of mappingEntries(mapping)) {
            if (text.startsWith(from + '.')) return to + text.substring(from.length);
        }
        return text;
    }

    function rewritePartReference(value, mapping) {
        const text = String(value == null ? '' : value);
        for (const [from, to] of mappingEntries(mapping)) {
            if (text.startsWith(from + '::')) return to + text.substring(from.length);
        }
        return text;
    }

    function rewriteNodeDataReferences(data, mapping) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
        if (typeof data.source === 'string') data.source = rewriteQualifiedReference(data.source, mapping);
        if (typeof data.target === 'string') {
            data.target = data.target.includes('::')
                ? rewritePartReference(data.target, mapping)
                : rewriteQualifiedReference(data.target, mapping);
        }
        if (typeof data.target_model === 'string') data.target_model = rewriteNodeId(data.target_model, mapping);
        return data;
    }

    function rewriteBindingReferences(binding, mapping) {
        if (!binding || typeof binding !== 'object') return binding;
        if (typeof binding.source === 'string') binding.source = rewriteQualifiedReference(binding.source, mapping);
        if (typeof binding.target === 'string') binding.target = rewriteQualifiedReference(binding.target, mapping);
        return binding;
    }

    function rewriteConnectionReferences(connection, mapping) {
        if (!connection || typeof connection !== 'object') return connection;
        if (typeof connection.from === 'string') connection.from = rewriteQualifiedReference(connection.from, mapping);
        const action = connection.action;
        if (action && typeof action === 'object' && typeof action.target === 'string') {
            action.target = rewriteQualifiedReference(action.target, mapping);
        }
        return connection;
    }

    function referenceUsesMappedNode(value, mapping, partReference = false) {
        const text = String(value == null ? '' : value);
        return mappingEntries(mapping).some(([from]) => partReference
            ? text.startsWith(from + '::')
            : text === from || text.startsWith(from + '.'));
    }

    function rewriteEditorStateReferences(state, mapping) {
        if (!state) return;
        (state.bindings || []).forEach(binding => rewriteBindingReferences(binding, mapping));
        (state.connections || []).forEach(connection => rewriteConnectionReferences(connection, mapping));
        if (state.preview_values && typeof state.preview_values === 'object') {
            const rewritten = {};
            Object.entries(state.preview_values).forEach(([address, value]) => {
                rewritten[rewriteQualifiedReference(address, mapping)] = value;
            });
            state.preview_values = rewritten;
        }
        if (state._resource_warnings && typeof state._resource_warnings === 'object') {
            const warnings = {};
            Object.entries(state._resource_warnings).forEach(([id, value]) => warnings[rewriteNodeId(id, mapping)] = value);
            state._resource_warnings = warnings;
        }
        state._resolved_preview_values = null;
        state._preview_definitions = null;
    }

    function renameNodeReferences(oldId, newId) {
        if (!oldId || !newId || oldId === newId) return;
        const mapping = new Map([[oldId, newId]]);
        ConsoleNodeElement.all.forEach(candidate => {
            let data;
            try { data = parseJsonObject(candidate.gfbs_data_json || '{}', `Node ${candidate.name} data`); }
            catch (_) { return; }
            rewriteNodeDataReferences(data, mapping);
            candidate.gfbs_data_json = pretty(data);
        });
        rewriteEditorStateReferences(getState(), mapping);
    }

    // -----------------------------
    // Validation mirroring GFBS runtime constraints
    // -----------------------------

    function collectElements() {
        return ConsoleNodeElement ? ConsoleNodeElement.all.slice() : [];
    }

    function builtinPropertyTypesFor(element) {
        const result = {};
        const type = element.gfbs_type;
        // ConsoleNode3D always supplies visible/enabled. Custom nodes explicitly
        // marked spatial are treated the same way for authoring/type checking.
        if (SPATIAL_TYPES.has(type) || element.gfbs_spatial) {
            result.visible = 'boolean';
            result.enabled = 'boolean';
        }
        if (type === 'gfbs_main:text') {
            result.text = 'string';
            result.color = 'color';
            result.fullbright = 'boolean';
        } else if (type === 'gfbs_main:model') {
            result.alpha = 'double';
        } else if (INTERACTION_TYPES.has(type)) {
            result.state = 'boolean';
            result.value = 'double';
        } else if (type === 'gfbs_main:animation') {
            result.playing = 'boolean';
            result.speed = 'double';
        } else if (type === 'gfbs_main:sound') {
            result.playing = 'boolean';
            result.volume = 'double';
            result.pitch = 'double';
        } else if (type === 'gfbs_main:timer') {
            result.running = 'boolean';
            result.elapsed = 'long';
            result.period = 'long';
        }
        return result;
    }

    function propertyDefinitionsFor(element) {
        const custom = nodeProperties(element);
        const result = Object.assign({}, custom);
        const builtins = builtinPropertyTypesFor(element);
        for (const [name, type] of Object.entries(builtins)) {
            result[name] = result[name] || {type};
        }
        return result;
    }

    function parseAddress(address) {
        const text = String(address || '');
        const index = text.lastIndexOf('.');
        if (index <= 0 || index >= text.length - 1) return null;
        return {node: text.substring(0, index), property: text.substring(index + 1)};
    }

    function normalizePropertyType(type) {
        const value = String(type || '').trim().toLowerCase();
        if (value === 'bool') return 'boolean';
        if (value === 'int') return 'integer';
        if (value === 'float' || value === 'number') return 'double';
        if (value === 'text') return 'string';
        if (value === 'argb' || value === 'rgb') return 'color';
        if (value === 'vector3') return 'vec3';
        if (value === 'resource_location' || value === 'id') return 'resource';
        return value;
    }

    function propertyDefinitionForAddress(address) {
        const parsed = parseAddress(address);
        if (!parsed) return null;
        const state = getState();
        if (parsed.node === '$root') return state && state.properties ? state.properties[parsed.property] || null : null;
        const element = ConsoleNodeElement && ConsoleNodeElement.all ? ConsoleNodeElement.all.find(el => el.name === parsed.node) : null;
        return element ? propertyDefinitionsFor(element)[parsed.property] || null : null;
    }

    function literalKind(value, preferredType) {
        const type = normalizePropertyType(preferredType || '');
        if (type === 'boolean') return 'boolean';
        if (['integer','long','double'].includes(type)) return 'number';
        if (type === 'vec3') return 'vec3';
        if (type === 'color') return 'color';
        if (type === 'resource') return 'resource';
        if (type === 'string') return 'string';
        if (typeof value === 'boolean') return 'boolean';
        if (typeof value === 'number') return 'number';
        if (Array.isArray(value) && value.length === 3) return 'vec3';
        return 'string';
    }

    function typedLiteralForm(prefix, value, preferredType, condition) {
        const kind = literalKind(value, preferredType);
        const vec = Array.isArray(value) && value.length === 3 ? value : [0,0,0];
        const baseCondition = condition || (() => true);
        const kindIs = expected => result => baseCondition(result) && String((result && result[prefix + '_kind']) || kind) === expected;
        return {
            [prefix + '_kind']:{label:'Value Type',type:'select',options:{boolean:'boolean',number:'number',string:'string',vec3:'vec3',color:'color',resource:'resource'},value:kind,condition:baseCondition},
            [prefix + '_boolean']:{label:'Value',type:'checkbox',value:typeof value==='boolean'?value:false,condition:kindIs('boolean')},
            [prefix + '_number']:{label:'Value',type:'number',value:Number.isFinite(Number(value))?Number(value):0,condition:kindIs('number')},
            [prefix + '_string']:{label:'Value',type:'text',value:typeof value==='string'?value:'',condition:kindIs('string')},
            [prefix + '_vec3']:{label:'Value',type:'vector',dimensions:3,value:vector3(vec,[0,0,0]),condition:kindIs('vec3')},
            [prefix + '_color']:{label:'Color (RRGGBB/AARRGGBB)',type:'text',value:typeof value==='string'?value:'#FFFFFFFF',condition:kindIs('color')},
            [prefix + '_resource']:{label:'ResourceLocation',type:'text',value:typeof value==='string'?value:'minecraft:air',condition:kindIs('resource')}
        };
    }

    function readTypedLiteral(result, prefix, preferredType) {
        const kind = String(result[prefix + '_kind'] || literalKind(undefined, preferredType));
        let value;
        if (kind === 'boolean') value = !!result[prefix + '_boolean'];
        else if (kind === 'number') {
            value = Number(result[prefix + '_number']);
            if (!Number.isFinite(value)) throw new Error('Literal number must be finite');
            if (['integer','long'].includes(normalizePropertyType(preferredType))) value = Math.trunc(value);
        } else if (kind === 'vec3') {
            value = vector3(result[prefix + '_vec3'], [0,0,0]);
            if (!value.every(Number.isFinite)) throw new Error('Literal vec3 must contain finite numbers');
        } else if (kind === 'color') {
            value = String(result[prefix + '_color'] || '').trim();
            const text = value.replace(/^#/, '');
            if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(text)) throw new Error('Color literal must be RRGGBB or AARRGGBB');
        } else if (kind === 'resource') {
            value = String(result[prefix + '_resource'] || '').trim();
            if (!parseResourceLocation(value)) throw new Error('Resource literal must be a valid ResourceLocation');
        } else value = String(result[prefix + '_string'] ?? '');
        return value;
    }

    function validatePropertyDefinition(name, def, errors, prefix) {
        const types = ['boolean','integer','long','double','string','color','vec3','resource'];
        if (!def || typeof def !== 'object' || Array.isArray(def)) { errors.push(`${prefix}.${name}: definition must be object`); return; }
        const type = normalizePropertyType(def.type);
        if (!types.includes(type)) { errors.push(`${prefix}.${name}: unknown type ${def.type}`); return; }
        if (!Object.prototype.hasOwnProperty.call(def, 'default')) { errors.push(`${prefix}.${name}: missing default`); return; }
        const value = def.default;
        if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${prefix}.${name}: boolean default required`);
        if ((type === 'integer' || type === 'long') && (!Number.isFinite(Number(value)) || !Number.isInteger(Number(value)))) errors.push(`${prefix}.${name}: integer default required`);
        if (type === 'double' && !Number.isFinite(Number(value))) errors.push(`${prefix}.${name}: finite numeric default required`);
        if (type === 'string' && (typeof value !== 'string' || value.length > 16384)) errors.push(`${prefix}.${name}: string default invalid/too long`);
        if (type === 'vec3' && (!Array.isArray(value) || value.length !== 3 || !value.every(v => Number.isFinite(Number(v))))) errors.push(`${prefix}.${name}: vec3 default must contain 3 finite numbers`);
        if (type === 'resource' && !parseResourceLocation(value)) errors.push(`${prefix}.${name}: invalid ResourceLocation default`);
        if (type === 'color') {
            const okNumber = Number.isInteger(value);
            const text = typeof value === 'string' ? value.replace(/^#/, '') : '';
            if (!okNumber && !/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(text)) errors.push(`${prefix}.${name}: color must be integer, RRGGBB, or AARRGGBB`);
        }
    }

    function validateCurrentScene(showDialog = true) {
        const errors = [];
        const warnings = [];
        const elements = collectElements();
        const ids = new Map();
        const indicatorChecks = [];
        const animationChecks = [];

        const finiteVec3 = value => Array.isArray(value) && value.length === 3 && value.every(v => Number.isFinite(Number(v)));
        const validateInferredLiteral = (value, label) => {
            if (typeof value === 'boolean') return;
            if (typeof value === 'number') { if (!Number.isFinite(value)) errors.push(`${label}: number must be finite`); return; }
            if (typeof value === 'string') { if (value.length > 16384) errors.push(`${label}: string is too long`); return; }
            if (finiteVec3(value)) return;
            errors.push(`${label}: value must be boolean, finite number, string, or vec3`);
        };
        const validateHitShape = (shape, label) => {
            if (!shape || typeof shape !== 'object' || Array.isArray(shape)) { errors.push(`${label}: interaction shape is required`); return; }
            const type = String(shape.type || '').toLowerCase();
            if (!['box','aabb','obb','sphere','cylinder','plane','plane_rect'].includes(type)) errors.push(`${label}: unknown hit shape ${shape.type}`);
            if (shape.center !== undefined && !finiteVec3(shape.center)) errors.push(`${label}: shape center must be vec3`);
            if (['box','aabb','obb'].includes(type)) {
                if (!finiteVec3(shape.size) || shape.size.some(v => Number(v) <= 0)) errors.push(`${label}: box size must contain 3 positive finite numbers`);
            } else if (type === 'sphere') {
                if (!Number.isFinite(Number(shape.radius)) || Number(shape.radius) <= 0) errors.push(`${label}: sphere radius must be positive`);
            } else if (type === 'cylinder') {
                if (!Number.isFinite(Number(shape.radius)) || Number(shape.radius) <= 0 || !Number.isFinite(Number(shape.height)) || Number(shape.height) <= 0) errors.push(`${label}: cylinder radius/height must be positive`);
            } else if (type === 'plane' || type === 'plane_rect') {
                if (!Number.isFinite(Number(shape.width)) || Number(shape.width) <= 0 || !Number.isFinite(Number(shape.height)) || Number(shape.height) <= 0) errors.push(`${label}: plane width/height must be positive`);
                if (shape.thickness !== undefined && (!Number.isFinite(Number(shape.thickness)) || Number(shape.thickness) <= 0)) errors.push(`${label}: plane thickness must be positive`);
            }
        };
        const validateProfiles = (profiles, label) => {
            if (profiles === undefined) return;
            if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) { errors.push(`${label}: material_profiles must be an object`); return; }
            for (const [name, profile] of Object.entries(profiles)) {
                if (!profile || typeof profile !== 'object' || Array.isArray(profile)) { errors.push(`${label}.${name}: profile must be an object`); continue; }
                const shading = String(profile.shading || 'pbr').toLowerCase();
                if (!['pbr','unlit','neon'].includes(shading)) errors.push(`${label}.${name}: invalid shading ${profile.shading}`);
                for (const [field, lengths] of [['color',[3,4]],['emissive_color',[3,4]]]) {
                    if (profile[field] !== undefined && (!Array.isArray(profile[field]) || !lengths.includes(profile[field].length) || !profile[field].every(v => Number.isFinite(Number(v))))) errors.push(`${label}.${name}: ${field} must contain 3 or 4 finite numbers`);
                }
                for (const field of ['alpha','emissive_strength','neon_strength']) {
                    if (profile[field] !== undefined && !Number.isFinite(Number(profile[field]))) errors.push(`${label}.${name}: ${field} must be finite`);
                }
                if (profile.emissive_strength !== undefined && Number(profile.emissive_strength) < 0) errors.push(`${label}.${name}: emissive_strength must be >= 0`);
                if (profile.neon_strength !== undefined && Number(profile.neon_strength) < 0) errors.push(`${label}.${name}: neon_strength must be >= 0`);
            }
        };

        if (elements.length > MAX_NODES) errors.push(`Node count ${elements.length} exceeds ${MAX_NODES}`);
        elements.forEach(element => {
            if (!validateNodeId(element.name)) errors.push(`Invalid node id: ${element.name}`);
            if (ids.has(element.name)) errors.push(`Duplicate node id: ${element.name}`);
            ids.set(element.name, element);
            if (!parseResourceLocation(element.gfbs_type)) errors.push(`${element.name}: invalid node type ${element.gfbs_type}`);
            let depth = 0, p = element.parent;
            while (p && p !== 'root') { depth++; p = p.parent; }
            if (depth > MAX_DEPTH) errors.push(`${element.name}: depth ${depth} exceeds ${MAX_DEPTH}`);

            const position = vector3(element.position,[0,0,0]);
            const rotation = vector3(element.rotation,[0,0,0]);
            const scale = vector3(element.scale,[1,1,1]);
            const pivot = vector3(element.gfbs_pivot,[0,0,0]);
            if (![...position,...rotation,...scale,...pivot].every(Number.isFinite)) errors.push(`${element.name}: transform values must be finite`);
            if (scale.some(v => Math.abs(v) < 1e-6)) errors.push(`${element.name}: scale components must be non-zero`);

            let properties, data;
            try { properties = parseJsonObject(element.gfbs_properties_json || '{}', `${element.name} properties`); }
            catch (error) { errors.push(error.message); properties = {}; }
            try { data = parseJsonObject(element.gfbs_data_json || '{}', `${element.name} data`); }
            catch (error) { errors.push(error.message); data = {}; }
            Object.entries(properties).forEach(([name, def]) => validatePropertyDefinition(name, def, errors, element.name));
            const builtinTypes = builtinPropertyTypesFor(element);
            Object.entries(properties).forEach(([name, def]) => {
                const expected = builtinTypes[name];
                if (expected && normalizePropertyType(def && def.type) !== expected) {
                    errors.push(`${element.name}: authored property ${name} changes built-in type ${expected} to ${def && def.type}`);
                }
            });

            if (element.gfbs_type === 'gfbs_main:model') {
                if (!data.source || !parseResourceLocation(data.source.adapter) || !parseResourceLocation(data.source.location)) errors.push(`${element.name}: model source requires valid adapter and location ResourceLocations`);
                if (data.parts !== undefined) {
                    if (!data.parts || typeof data.parts !== 'object' || Array.isArray(data.parts)) errors.push(`${element.name}: parts must be an object`);
                    else Object.entries(data.parts).forEach(([alias,value]) => { if (!alias || typeof value !== 'string' || !value) errors.push(`${element.name}: invalid part alias ${alias}`); });
                }
                validateProfiles(data.material_profiles, `${element.name}.material_profiles`);
            }
            if (element.gfbs_type === 'gfbs_main:text') {
                if (data.pixel_scale !== undefined && (!Number.isFinite(Number(data.pixel_scale)) || Number(data.pixel_scale) <= 0)) errors.push(`${element.name}: pixel_scale must be positive`);
            }
            if (element.gfbs_type === 'gfbs_main:indicator') {
                if (!parseAddress(data.source)) errors.push(`${element.name}: invalid indicator source`);
                if (typeof data.target !== 'string' || !data.target.includes('::')) errors.push(`${element.name}: indicator target must be modelNode::partAlias`);
                if (!data.states || typeof data.states !== 'object' || Array.isArray(data.states) || !Object.keys(data.states).length) errors.push(`${element.name}: indicator states are required`);
                indicatorChecks.push({element,data});
            }
            if (element.gfbs_type === 'gfbs_main:animation') {
                if (typeof data.target_model !== 'string' || !data.target_model) errors.push(`${element.name}: target_model is required`);
                if (typeof data.animation !== 'string' || !data.animation) errors.push(`${element.name}: animation is required`);
                animationChecks.push({element,data});
            }
            if (INTERACTION_TYPES.has(element.gfbs_type)) {
                const interaction = interactionObject(data);
                const max = interaction.max_distance === undefined ? 5 : Number(interaction.max_distance);
                if (!Number.isFinite(max) || max <= 0 || max > 16) errors.push(`${element.name}: max_distance must be > 0 and <= 16`);
                validateHitShape(interaction.shape, element.name);
                const min = interaction.min === undefined ? 0 : Number(interaction.min);
                const maximum = interaction.max === undefined ? 1 : Number(interaction.max);
                const step = interaction.step === undefined ? 0 : Number(interaction.step);
                if (![min, maximum, step].every(Number.isFinite) || maximum < min || step < 0) errors.push(`${element.name}: invalid interaction range`);
                if (element.gfbs_type === 'gfbs_main:interaction' && data.control !== undefined && !['GENERIC','MOMENTARY','TOGGLE','KNOB','LEVER','SLIDER'].includes(String(data.control).toUpperCase())) errors.push(`${element.name}: invalid generic control type ${data.control}`);
            }
            if (element.gfbs_type === 'gfbs_main:sound') {
                if (!parseResourceLocation(data.sound)) errors.push(`${element.name}: invalid sound ResourceLocation`);
                const min = data.min_distance === undefined ? 1 : Number(data.min_distance);
                const max = data.max_distance === undefined ? 64 : Number(data.max_distance);
                const speed = data.speed === undefined ? 1 : Number(data.speed);
                if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max <= min) errors.push(`${element.name}: invalid sound distance/speed`);
            }
            if (element.gfbs_type === 'gfbs_main:timer' && data.interval !== undefined && (!Number.isFinite(Number(data.interval)) || !Number.isInteger(Number(data.interval)) || Number(data.interval) < 1)) errors.push(`${element.name}: timer interval must be an integer >= 1`);
            if (LAYOUT_TYPES.has(element.gfbs_type)) {
                if (data.spacing !== undefined && !finiteVec3(data.spacing)) errors.push(`${element.name}: layout spacing must be vec3`);
                if (element.gfbs_type !== 'gfbs_main:linear_layout' && data.columns !== undefined && (!Number.isFinite(Number(data.columns)) || !Number.isInteger(Number(data.columns)) || Number(data.columns) < 1)) errors.push(`${element.name}: columns must be an integer >= 1`);
            }
        });
        const roots = Outliner.root.filter(node => node instanceof ConsoleNodeElement);
        if (roots.length !== 1) errors.push(`Scene must have exactly one GFBS root node; found ${roots.length}`);

        const state = getState();
        Object.entries((state && state.properties) || {}).forEach(([name, def]) => validatePropertyDefinition(name, def, errors, '$root'));
        function checkAddress(address, label) {
            const parsed = parseAddress(address);
            if (!parsed) { errors.push(`${label}: invalid property address ${address}`); return null; }
            if (parsed.node === '$root') {
                if (!state.properties[parsed.property]) { errors.push(`${label}: unknown root property ${parsed.property}`); return null; }
                return state.properties[parsed.property];
            }
            const el = ids.get(parsed.node);
            if (!el) { errors.push(`${label}: unknown node ${parsed.node}`); return null; }
            const def = propertyDefinitionsFor(el)[parsed.property];
            if (!def) warnings.push(`${label}: property ${address} is not authored/known built-in; third-party node may provide it`);
            return def || null;
        }

        indicatorChecks.forEach(({element,data}) => {
            checkAddress(data.source, `${element.name} indicator source`);
            if (typeof data.target !== 'string') return;
            const sep=data.target.indexOf('::'); if(sep<=0)return;
            const model=ids.get(data.target.substring(0,sep));
            if (!model || model.gfbs_type !== 'gfbs_main:model') { errors.push(`${element.name}: indicator target model does not exist or is not a model`); return; }
            const modelData=nodeData(model); const profiles=modelData.material_profiles&&typeof modelData.material_profiles==='object'?modelData.material_profiles:{};
            if (data.states && typeof data.states==='object') Object.entries(data.states).forEach(([key,profile]) => {
                if (typeof profile !== 'string' || !profiles[profile]) errors.push(`${element.name}: state ${key} references unknown material profile ${profile}`);
            });
        });
        animationChecks.forEach(({element,data}) => {
            const model=ids.get(data.target_model);
            if (!model || model.gfbs_type !== 'gfbs_main:model') errors.push(`${element.name}: target_model ${data.target_model} does not exist or is not a model node`);
        });

        (state.bindings || []).forEach((binding, i) => {
            if (!binding || typeof binding !== 'object') { errors.push(`Binding #${i}: must be object`); return; }
            checkAddress(binding.source, `Binding #${i} source`);
            checkAddress(binding.target, `Binding #${i} target`);
            if (binding.map !== undefined) {
                if (!binding.map || typeof binding.map !== 'object' || Array.isArray(binding.map)) errors.push(`Binding #${i}: map must be an object`);
                else Object.entries(binding.map).forEach(([key,value]) => validateInferredLiteral(value, `Binding #${i} map.${key}`));
            }
            if (binding.range) ['input_min','input_max','output_min','output_max'].forEach(k => { if (!Number.isFinite(Number(binding.range[k]))) errors.push(`Binding #${i}: range.${k} must be finite`); });
            if (binding.format !== undefined && typeof binding.format !== 'string') errors.push(`Binding #${i}: format must be a string`);
        });
        (state.connections || []).forEach((connection, i) => {
            if (!connection || typeof connection !== 'object') { errors.push(`Connection #${i}: must be object`); return; }
            const from = String(connection.from || '');
            const sep = from.lastIndexOf('.');
            if (sep <= 0 || sep >= from.length-1 || !ids.has(from.substring(0, sep))) errors.push(`Connection #${i}: invalid signal source ${from}`);
            const action=connection.action;
            if (!action || typeof action !== 'object' || Array.isArray(action)) { errors.push(`Connection #${i}: action is required`); return; }
            const typeText=String(action.type||''); if(!typeText){errors.push(`Connection #${i}: action.type is required`);return;}
            const normalizedActionId = typeText.includes(':') ? typeText : `gfbs_main:${typeText}`;
            if(!parseResourceLocation(normalizedActionId))errors.push(`Connection #${i}: invalid action type ${typeText}`);
            const canonical=typeText.startsWith('gfbs_main:')?typeText.substring('gfbs_main:'.length):typeText;
            if(canonical==='set'){
                const targetDef=checkAddress(action.target,`Connection #${i} set target`);
                if(!Object.prototype.hasOwnProperty.call(action,'value'))errors.push(`Connection #${i}: set action requires value`);
                else if(targetDef)validatePropertyDefinition('value',{type:targetDef.type,default:action.value},errors,`Connection #${i}`);
            }else if(canonical==='toggle'){
                const targetDef=checkAddress(action.target,`Connection #${i} toggle target`);
                if(targetDef&&normalizePropertyType(targetDef.type)!=='boolean')errors.push(`Connection #${i}: toggle target must be boolean`);
            }else if(canonical==='emit'){
                const target=String(action.target||'');const ts=target.lastIndexOf('.');
                if(ts<=0||ts>=target.length-1||!ids.has(target.substring(0,ts)))errors.push(`Connection #${i}: emit target must be existing node.signal`);
            }else if(canonical==='host'){
                if(!parseResourceLocation(action.id))errors.push(`Connection #${i}: host action id must be a valid ResourceLocation`);
                if(Object.prototype.hasOwnProperty.call(action,'value'))validateInferredLiteral(action.value,`Connection #${i} host value`);
            }
        });

        if (showDialog) {
            Blockbench.showMessageBox({
                title: 'GFBS Console Validation',
                icon: errors.length ? 'error' : warnings.length ? 'warning' : 'check_circle',
                message: errors.length ? `${errors.length} error(s), ${warnings.length} warning(s)` : warnings.length ? `${warnings.length} warning(s)` : 'Scene is valid for GFBS 3D-CONSOLE format_version 1.',
                detail: [...errors.map(e => 'ERROR: ' + e), ...warnings.map(w => 'WARN: ' + w)].join('\n') || undefined
            });
        }
        return {errors, warnings};
    }
    function typeOptions() {
        const result = {};
        BUILTIN_TYPES.forEach(type => result[type] = type.replace('gfbs_main:', ''));
        return result;
    }

    function selectedConsoleNode() {
        const selected = Outliner.selected && Outliner.selected.find(node => node instanceof ConsoleNodeElement);
        if (!selected) showInfo('Select a GFBS Console node first');
        return selected || null;
    }

    function modelNodeOptions() {
        const options = {'__custom__':'<Custom model node>'};
        ConsoleNodeElement.all.filter(el => el.gfbs_type === 'gfbs_main:model').forEach(el => options[el.name] = el.name);
        return options;
    }

    function indicatorTargetOptions() {
        const options = {'__custom__':'<Custom model::part>'};
        ConsoleNodeElement.all.filter(el => el.gfbs_type === 'gfbs_main:model').forEach(el => {
            const data = nodeData(el);
            const parts = data.parts && typeof data.parts === 'object' && !Array.isArray(data.parts) ? data.parts : {};
            if (!Object.keys(parts).length) options[`${el.name}::/`] = `${el.name} :: /`;
            Object.keys(parts).forEach(alias => options[`${el.name}::${alias}`] = `${el.name} :: ${alias}`);
        });
        return options;
    }

    function openNodeEditor(element) {
        if (!element) return;
        const data = nodeData(element);
        const interaction = interactionObject(data);
        const initialType = element.gfbs_type;
        const dialogType = result => String((result && result.custom_type) || '').trim() || ((result && result.node_type) || initialType);
        const isType = (...types) => result => types.includes(dialogType(result));
        const isInteraction = result => INTERACTION_TYPES.has(dialogType(result));
        const isLayout = result => LAYOUT_TYPES.has(dialogType(result));
        const isGridLayout = result => ['gfbs_main:grid_layout', 'gfbs_main:surface_layout'].includes(dialogType(result));

        const source = data.source || {};
        const propertyAddresses = propertyAddressOptions();
        const propertyAddressChoices = {'__custom__':'<Custom property address>', ...propertyAddresses};
        const indicatorTargets = indicatorTargetOptions();
        const modelChoices = modelNodeOptions();
        const form = {
            id: {label: 'Node ID', type: 'text', value: element.name},
            node_type: {label: 'Node Type', type: 'select', options: typeOptions(), value: BUILTIN_TYPES.includes(initialType) ? initialType : BUILTIN_TYPES[1]},
            custom_type: {label: 'Custom Type (optional)', type: 'text', value: BUILTIN_TYPES.includes(initialType) ? '' : initialType},
            spatial: {label: 'Spatial / uses transform', type: 'checkbox', value: element.gfbs_spatial !== false},
            position: {label: 'Position (blocks)', type: 'vector', dimensions: 3, value: vector3(element.position, [0,0,0]).map(v => v / BB_UNITS_PER_BLOCK)},
            rotation: {label: 'Rotation XYZ (degrees)', type: 'vector', dimensions: 3, value: vector3(element.rotation, [0,0,0])},
            scale: {label: 'Scale', type: 'vector', dimensions: 3, value: vector3(element.scale, [1,1,1])},
            pivot: {label: 'Pivot (blocks)', type: 'vector', dimensions: 3, value: vector3(element.gfbs_pivot, [0,0,0])},

            source_adapter: {label: 'Model Adapter', type: 'text', value: source.adapter || 'gfbs_main:gltf', condition: isType('gfbs_main:model')},
            source_location: {label: 'Model Resource', type: 'text', value: source.location || '', condition: isType('gfbs_main:model')},

            text: {label: 'Text', type: 'text', value: data.text || '', condition: isType('gfbs_main:text')},
            pixel_scale: {label: 'Pixel Scale', type: 'number', value: finiteNumber(data.pixel_scale, 0.01), step: 0.0001, min: 0.000001, condition: isType('gfbs_main:text')},

            indicator_source: {label: 'Source Property', type: 'select', options: propertyAddressChoices, value: propertyAddresses[data.source] ? data.source : '__custom__', condition: isType('gfbs_main:indicator')},
            indicator_source_custom: {label: 'Custom Source Property', type: 'text', value: propertyAddresses[data.source] ? '' : (data.source || '$root.power'), condition: isType('gfbs_main:indicator')},
            indicator_target: {label: 'Target model::part', type: 'select', options: indicatorTargets, value: indicatorTargets[data.target] ? data.target : '__custom__', condition: isType('gfbs_main:indicator')},
            indicator_target_custom: {label: 'Custom model::part', type: 'text', value: indicatorTargets[data.target] ? '' : (data.target || 'model::whole'), condition: isType('gfbs_main:indicator')},

            target_model: {label: 'Target Model Node', type: 'select', options: modelChoices, value: modelChoices[data.target_model] ? data.target_model : '__custom__', condition: isType('gfbs_main:animation')},
            target_model_custom: {label: 'Custom Target Model', type: 'text', value: modelChoices[data.target_model] ? '' : (data.target_model || ''), condition: isType('gfbs_main:animation')},
            animation: {label: 'Animation Name', type: 'text', value: data.animation || '', condition: isType('gfbs_main:animation')},

            sound: {label: 'Sound Resource', type: 'text', value: data.sound || '', condition: isType('gfbs_main:sound')},
            looping: {label: 'Looping', type: 'checkbox', value: !!data.looping, condition: isType('gfbs_main:sound')},
            streamed: {label: 'Streamed', type: 'checkbox', value: !!data.streamed, condition: isType('gfbs_main:sound')},
            static_sound: {label: 'Static', type: 'checkbox', value: !!data.static, condition: isType('gfbs_main:sound')},
            priority: {label: 'Priority', type: 'number', value: finiteNumber(data.priority, 0), step: 1, condition: isType('gfbs_main:sound')},
            sound_speed: {label: 'Speed', type: 'number', value: finiteNumber(data.speed, 1), step: 0.05, min: 0.000001, condition: isType('gfbs_main:sound')},
            sound_min_distance: {label: 'Min Distance', type: 'number', value: finiteNumber(data.min_distance, 1), step: 0.1, min: 0, condition: isType('gfbs_main:sound')},
            sound_max_distance: {label: 'Max Distance', type: 'number', value: finiteNumber(data.max_distance, 64), step: 0.1, min: 0.000001, condition: isType('gfbs_main:sound')},

            interval: {label: 'GT Interval', type: 'number', value: Math.max(1, Math.floor(finiteNumber(data.interval, 1))), min: 1, step: 1, condition: isType('gfbs_main:timer')},

            spacing: {label: 'Layout Spacing (blocks)', type: 'vector', dimensions: 3, value: vector3(data.spacing, [0.1,0.1,0.1]), condition: isLayout},
            columns: {label: 'Columns', type: 'number', value: Math.max(1, Math.floor(finiteNumber(data.columns, 1))), min: 1, step: 1, condition: isGridLayout},

            interaction_max_distance: {label: 'Interaction Max Distance', type: 'number', value: finiteNumber(interaction.max_distance, 5), min: 0.01, max: 16, step: 0.1, condition: isInteraction},
            range_min: {label: 'Control Minimum', type: 'number', value: finiteNumber(interaction.min, 0), condition: isInteraction},
            range_max: {label: 'Control Maximum', type: 'number', value: finiteNumber(interaction.max, 1), condition: isInteraction},
            range_step: {label: 'Control Step', type: 'number', value: finiteNumber(interaction.step, 0), min: 0, condition: isInteraction},
            control: {label: 'Generic Control Type', type: 'select', options: {GENERIC:'GENERIC', MOMENTARY:'MOMENTARY', TOGGLE:'TOGGLE', KNOB:'KNOB', LEVER:'LEVER', SLIDER:'SLIDER'}, value: String(data.control || 'GENERIC').toUpperCase(), condition: isType('gfbs_main:interaction')},

            advanced: {label: 'Advanced / third-party node fields', type: 'textarea', value: pretty(data), height: 180}
        };

        new Dialog({
            id: 'gfbs_console_node_editor',
            title: `GFBS Node: ${element.name}`,
            width: 680,
            resizable: true,
            form,
            onConfirm(result) {
                try {
                    if (!validateNodeId(result.id)) throw new Error('Node ID must match [a-zA-Z_][a-zA-Z0-9_.-]{0,95}');
                    const duplicate = ConsoleNodeElement.all.find(e => e !== element && e.name === result.id);
                    if (duplicate) throw new Error(`Node ID ${result.id} already exists`);
                    const newData = parseJsonObject(result.advanced || '{}', 'Advanced node fields');
                    const newProperties = clone(nodeProperties(element));
                    const newType = dialogType(result);
                    if (!parseResourceLocation(newType)) throw new Error(`Invalid node type ${newType}`);

                    if (newType === 'gfbs_main:model') {
                        newData.source = {adapter: String(result.source_adapter || 'gfbs_main:gltf'), location: String(result.source_location || '')};
                    } else if (newType === 'gfbs_main:text') {
                        newData.text = String(result.text || '');
                        newData.pixel_scale = finiteNumber(result.pixel_scale, 0.01);
                        if (newData.pixel_scale <= 0) throw new Error('pixel_scale must be positive');
                    } else if (newType === 'gfbs_main:indicator') {
                        newData.source = result.indicator_source === '__custom__' ? String(result.indicator_source_custom || '').trim() : String(result.indicator_source || '').trim();
                        newData.target = result.indicator_target === '__custom__' ? String(result.indicator_target_custom || '').trim() : String(result.indicator_target || '').trim();
                        if (!newData.states || typeof newData.states !== 'object' || Array.isArray(newData.states)) newData.states = {false: 'off', true: 'on'};
                    } else if (newType === 'gfbs_main:animation') {
                        newData.target_model = result.target_model === '__custom__' ? String(result.target_model_custom || '').trim() : String(result.target_model || '').trim();
                        newData.animation = String(result.animation || '');
                    } else if (newType === 'gfbs_main:sound') {
                        newData.sound = String(result.sound || '');
                        newData.looping = !!result.looping;
                        newData.streamed = !!result.streamed;
                        newData.static = !!result.static_sound;
                        newData.priority = Math.floor(finiteNumber(result.priority, 0));
                        newData.speed = finiteNumber(result.sound_speed, 1);
                        newData.min_distance = finiteNumber(result.sound_min_distance, 1);
                        newData.max_distance = finiteNumber(result.sound_max_distance, 64);
                        if (newData.speed <= 0 || newData.min_distance < 0 || newData.max_distance <= newData.min_distance) throw new Error('Invalid sound speed/distance range');
                    } else if (newType === 'gfbs_main:timer') {
                        newData.interval = Math.max(1, Math.floor(finiteNumber(result.interval, 1)));
                    } else if (LAYOUT_TYPES.has(newType)) {
                        newData.spacing = vector3(result.spacing, [0.1,0.1,0.1]);
                        if (newType !== 'gfbs_main:linear_layout') newData.columns = Math.max(1, Math.floor(finiteNumber(result.columns, 1)));
                        else delete newData.columns;
                    }
                    if (INTERACTION_TYPES.has(newType)) {
                        const editedInteraction = newData.interaction && typeof newData.interaction === 'object' && !Array.isArray(newData.interaction) ? newData.interaction : {};
                        editedInteraction.max_distance = finiteNumber(result.interaction_max_distance, 5);
                        editedInteraction.min = finiteNumber(result.range_min, 0);
                        editedInteraction.max = finiteNumber(result.range_max, 1);
                        editedInteraction.step = Math.max(0, finiteNumber(result.range_step, 0));
                        if (editedInteraction.max_distance <= 0 || editedInteraction.max_distance > 16) throw new Error('Interaction max_distance must be > 0 and <= 16');
                        if (editedInteraction.max < editedInteraction.min) throw new Error('Control maximum cannot be less than minimum');
                        if (!editedInteraction.shape) editedInteraction.shape = {type:'box', center:[0,0,0], size:[0.25,0.2,0.12]};
                        newData.interaction = editedInteraction;
                        if (newType === 'gfbs_main:interaction') newData.control = result.control;
                    }

                    const newScale = vector3(result.scale, [1,1,1]);
                    if (newScale.some(value => Math.abs(value) < 1e-6)) throw new Error('Scale components must be non-zero');
                    Object.entries(newProperties).forEach(([name, definition]) => {
                        const errors = [];
                        validatePropertyDefinition(name, definition, errors, result.id);
                        if (errors.length) throw new Error(errors.join('\n'));
                    });

                    const oldId = element.name;
                    Undo.initEdit({elements: ConsoleNodeElement.all.slice(), outliner: true, selection: true});
                    element.name = result.id;
                    element.gfbs_type = newType;
                    element.gfbs_spatial = SPATIAL_TYPES.has(newType) || !!result.spatial;
                    element.icon = TYPE_ICONS[newType] || (element.gfbs_spatial ? 'open_with' : 'account_tree');
                    element.position = vector3(result.position, [0,0,0]).map(v => v * BB_UNITS_PER_BLOCK);
                    element.rotation = vector3(result.rotation, [0,0,0]);
                    element.scale = newScale;
                    element.gfbs_pivot = vector3(result.pivot, [0,0,0]);
                    element.gfbs_data_json = pretty(newData);
                    element.gfbs_properties_json = pretty(newProperties);
                    renameNodeReferences(oldId, result.id);
                    element.updateElement();
                    updateElementDecoration(element);
                    refreshAllTransforms();
                    Undo.finishEdit('Edit GFBS console node');
                    markDirty();
                } catch (error) { showError(error.message); }
            }
        }).show();
    }

    function uniqueNodeName(base) {
        base=String(base||'node').replace(/[^a-zA-Z0-9_.-]/g,'_');
        if(!/^[a-zA-Z_]/.test(base))base='node_'+base;
        let name=base||'node',i=2;
        while(ConsoleNodeElement.all.some(e=>e.name===name))name=`${base}_${i++}`;
        return name;
    }

    function createConsoleNode(type,parent,options={}) {
        const baseName=options.name||type.split(':').pop().replace(/[^a-zA-Z0-9_]/g,'_');
        const name=uniqueNodeName(baseName);
        const data=options.data!==undefined?clone(options.data):defaultDataForType(type);
        const properties=options.properties!==undefined?clone(options.properties):defaultPropertiesForType(type);
        const ownsUndo = options.noUndo !== true;
        if (ownsUndo) Undo.initEdit({outliner:true,elements:[],selection:true});
        const element=new ConsoleNodeElement({
            name,
            gfbs_type:type,
            gfbs_spatial:SPATIAL_TYPES.has(type),
            position:vector3(options.position,[0,0,0]).map(v=>v*BB_UNITS_PER_BLOCK),
            rotation:vector3(options.rotation,[0,0,0]),
            scale:vector3(options.scale,[1,1,1]),
            gfbs_pivot:vector3(options.pivot,[0,0,0]),
            gfbs_data_json:pretty(data),
            gfbs_properties_json:pretty(properties)
        }).init().addTo(parent||getCurrentConsoleParent());
        if (options.select !== false) element.select();
        resolvePreviewValues();
        updateElementDecoration(element);
        if (options.refresh !== false) refreshAllTransforms();
        if (ownsUndo) Undo.finishEdit('Add GFBS console node');
        if(options.openEditor!==false)openNodeEditor(element);
        return element;
    }

    function addNode(parent,forcedType) {
        if(forcedType)return createConsoleNode(forcedType,parent);
        new Dialog({
            id:'gfbs_console_add_node_dialog',
            title:'Add GFBS Console Node',
            form:{type:{label:'Node Type',type:'select',options:typeOptions(),value:'gfbs_main:model'}},
            onConfirm(result){createConsoleNode(result.type,parent);}
        }).show();
    }

    function quickAddVanillaModel(){
        new Dialog({id:'gfbs_console_quick_vanilla',title:'Add Minecraft / Vanilla Model',width:560,form:{
            id:{label:'Node ID',type:'text',value:uniqueNodeName('model')},
            resource:{label:'Model / Block ResourceLocation',type:'text',value:'minecraft:stone'},
            position:{label:'Position (blocks)',type:'vector',dimensions:3,value:[0,0,0]}
        },onConfirm(result){
            if(!validateNodeId(result.id))return showError('Invalid Node ID');
            if(!parseResourceLocation(result.resource))return showError('Invalid model ResourceLocation');
            createConsoleNode('gfbs_main:model',null,{name:result.id,position:result.position,openEditor:false,data:{source:{adapter:'gfbs_main:vanilla_json',location:result.resource},parts:{whole:'/'}}});
        }}).show();
    }

    function quickAddGltfModel(){
        new Dialog({id:'gfbs_console_quick_gltf',title:'Add GFBS glTF Model',width:600,form:{
            id:{label:'Node ID',type:'text',value:uniqueNodeName('gltf_model')},
            resource:{label:'glTF ResourceLocation',type:'text',value:'gfbs_main:models/console/model.gltf'},
            position:{label:'Position (blocks)',type:'vector',dimensions:3,value:[0,0,0]}
        },onConfirm(result){
            if(!validateNodeId(result.id))return showError('Invalid Node ID');
            if(!parseResourceLocation(result.resource))return showError('Invalid glTF ResourceLocation');
            createConsoleNode('gfbs_main:model',null,{name:result.id,position:result.position,openEditor:false,data:{source:{adapter:'gfbs_main:gltf',location:result.resource},parts:{whole:'/'}}});
        }}).show();
    }

    function quickAddText(){
        new Dialog({id:'gfbs_console_quick_text',title:'Add Console Text',width:540,form:{
            id:{label:'Node ID',type:'text',value:uniqueNodeName('text')},
            text:{label:'Text',type:'text',value:'TEXT'},
            pixel_scale:{label:'Pixel Scale',type:'number',value:0.0045,min:0.000001,step:0.0001},
            position:{label:'Position (blocks)',type:'vector',dimensions:3,value:[0,0,0]}
        },onConfirm(result){
            if(!validateNodeId(result.id))return showError('Invalid Node ID');
            createConsoleNode('gfbs_main:text',null,{name:result.id,position:result.position,openEditor:false,data:{text:String(result.text||''),pixel_scale:Number(result.pixel_scale)||0.0045},properties:defaultPropertiesForType('gfbs_main:text')});
        }}).show();
    }

    function quickAddControl(type){
        return createConsoleNode(type,null,{name:uniqueNodeName(type.split(':').pop())});
    }

    function getCurrentConsoleParent() {
        const selected = Outliner.selected && Outliner.selected.find(node => node instanceof ConsoleNodeElement);
        return selected || 'root';
    }

    function defaultDataForType(type) {
        if (type === 'gfbs_main:model') return {source:{adapter:'gfbs_main:gltf', location:'gfbs_main:models/console/model.gltf'}, parts:{whole:'/'} };
        if (type === 'gfbs_main:text') return {text:'TEXT', pixel_scale:0.0045};
        if (type === 'gfbs_main:indicator') return {source:'$root.power', target:'model::whole', states:{false:'off', true:'on'}};
        if (type === 'gfbs_main:animation') return {target_model:'model', animation:'animation'};
        if (type === 'gfbs_main:sound') return {sound:'gfbs_main:surroundings.ding', looping:false, streamed:false, static:false, priority:0, speed:1, min_distance:1, max_distance:64};
        if (type === 'gfbs_main:timer') return {interval:1};
        if (LAYOUT_TYPES.has(type)) return Object.assign({spacing:[0.25,0.25,0]}, type === 'gfbs_main:linear_layout' ? {} : {columns:3});
        if (INTERACTION_TYPES.has(type)) {
            let shape = {type:'box', center:[0,0,0], size:[0.25,0.2,0.12]};
            if (type === 'gfbs_main:knob') shape = {type:'cylinder', center:[0,0,0], radius:0.12, height:0.1};
            else if (type === 'gfbs_main:lever') shape = {type:'box', center:[0,0.08,0], size:[0.14,0.32,0.12]};
            else if (type === 'gfbs_main:slider') shape = {type:'plane_rect', center:[0,0,0], width:0.12, height:0.42, thickness:0.04};
            return {interaction:{max_distance:5, shape, min:0, max:1, step:type === 'gfbs_main:knob' || type === 'gfbs_main:slider' ? 0.05 : 0}};
        }
        return {};
    }

    function defaultPropertiesForType(type) {
        if (type === 'gfbs_main:text') return {
            color:{type:'color', default:'#FFFFFFFF', sync:true},
            fullbright:{type:'boolean', default:false, sync:true}
        };
        if (type === 'gfbs_main:animation') return {
            playing:{type:'boolean', default:false, sync:true, save:true},
            speed:{type:'double', default:1.0, sync:true, save:true, interpolate:true}
        };
        if (type === 'gfbs_main:sound') return {
            playing:{type:'boolean', default:false, sync:true, save:false},
            volume:{type:'double', default:1.0, sync:true, save:false, interpolate:true},
            pitch:{type:'double', default:1.0, sync:true, save:false, interpolate:true}
        };
        if (type === 'gfbs_main:timer') return {
            running:{type:'boolean', default:true, sync:true, save:true},
            elapsed:{type:'long', default:0, sync:true, save:true},
            period:{type:'long', default:20, sync:false, save:true}
        };
        return {};
    }

    function subtreeElements(root) {
        const result = [];
        const visit = element => {
            if (!(element instanceof ConsoleNodeElement)) return;
            result.push(element);
            (element.children || []).forEach(visit);
        };
        visit(root);
        return result;
    }

    function uniqueNameAgainstSet(base, reserved) {
        const clean = String(base || 'node').replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^[^a-zA-Z_]+/, 'node_');
        let name = clean || 'node';
        let index = 2;
        while (reserved.has(name)) name = `${clean}_${index++}`;
        reserved.add(name);
        return name;
    }

    function duplicateSelectedSubtree() {
        const sourceRoot = selectedConsoleNode();
        if (!sourceRoot) return;
        if (sourceRoot.parent === 'root') return showError('The Scene root cannot be duplicated. Select one of its descendants.');
        const sources = subtreeElements(sourceRoot);
        const sourceSet = new Set(sources.map(element => element.name));
        const reserved = new Set(ConsoleNodeElement.all.map(element => element.name));
        const mapping = new Map();
        sources.forEach(element => mapping.set(element.name, uniqueNameAgainstSet(`${element.name}_copy`, reserved)));

        const state = getState();
        const oldBindings = (state.bindings || []).slice();
        const oldConnections = (state.connections || []).slice();
        const oldPreviewValues = Object.assign({}, state.preview_values || {});
        Undo.initEdit({outliner:true,elements:[],selection:true});

        function instantiate(source, parent, isRoot) {
            const data = clone(nodeData(source));
            rewriteNodeDataReferences(data, mapping);
            const position = vector3(source.position, [0,0,0]).map(value => value / BB_UNITS_PER_BLOCK);
            if (isRoot) position[0] += 0.25;
            const copy = createConsoleNode(source.gfbs_type, parent, {
                name:mapping.get(source.name),
                data,
                properties:clone(nodeProperties(source)),
                position,
                rotation:vector3(source.rotation, [0,0,0]),
                scale:vector3(source.scale, [1,1,1]),
                pivot:vector3(source.gfbs_pivot, [0,0,0]),
                openEditor:false,
                noUndo:true,
                select:false,
                refresh:false
            });
            copy.gfbs_spatial = source.gfbs_spatial;
            copy.visibility = source.visibility !== false;
            (source.children || []).filter(child => child instanceof ConsoleNodeElement).forEach(child => instantiate(child, copy, false));
            return copy;
        }

        const copyRoot = instantiate(sourceRoot, sourceRoot.parent, true);
        oldBindings.forEach(binding => {
            if (!binding || (!referenceUsesMappedNode(binding.source, mapping) && !referenceUsesMappedNode(binding.target, mapping))) return;
            const copied = rewriteBindingReferences(clone(binding), mapping);
            state.bindings.push(copied);
        });
        oldConnections.forEach(connection => {
            if (!connection) return;
            const actionTarget = connection.action && connection.action.target;
            if (!referenceUsesMappedNode(connection.from, mapping) && !referenceUsesMappedNode(actionTarget, mapping)) return;
            state.connections.push(rewriteConnectionReferences(clone(connection), mapping));
        });
        Object.entries(oldPreviewValues).forEach(([address, value]) => {
            const parsedNode = Array.from(sourceSet).some(id => address.startsWith(id + '.'));
            if (parsedNode) state.preview_values[rewriteQualifiedReference(address, mapping)] = clone(value);
        });
        state._resolved_preview_values = null;
        state._preview_definitions = null;
        copyRoot.select();
        refreshAllDecorations();
        Undo.finishEdit('Duplicate GFBS console subtree');
        markDirty();
        showInfo(`Duplicated ${sources.length} node(s) as ${copyRoot.name}`);
    }

    function copySelectedNodeJson() {
        const element = selectedConsoleNode();
        if (!element) return;
        try {
            const text = pretty(compileNode(element, 0));
            if (typeof Clipbench !== 'undefined' && Clipbench.setText) Clipbench.setText(text);
            else if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
            else throw new Error('Clipboard API is unavailable in this Blockbench build');
            showInfo(`Copied ${element.name} subtree JSON`);
        } catch (error) { showError(error.message); }
    }

    function elementPath(element) {
        const parts = [];
        let current = element;
        while (current && current !== 'root') {
            if (current instanceof ConsoleNodeElement) parts.unshift(current.name);
            current = current.parent;
        }
        return parts.join(' / ');
    }

    function focusConsoleNode(element) {
        if (!element) return;
        let parent = element.parent;
        while (parent && parent !== 'root') {
            parent.isOpen = true;
            parent = parent.parent;
        }
        element.select();
        if (typeof Canvas !== 'undefined' && Canvas.updateView) {
            Canvas.updateView({elements:[element], selection:true, element_aspects:{transform:true,geometry:true}});
        }
        refreshHelperVisibility(element);
        showInfo(`Selected ${element.name}`);
    }

    function showNodeFinder() {
        const nodes = ConsoleNodeElement.all.slice().sort((a,b) => elementPath(a).localeCompare(elementPath(b)));
        if (!nodes.length) return showInfo('Scene contains no Console nodes');
        const options = {};
        nodes.forEach(element => options[element.uuid] = `${elementPath(element)}  [${element.gfbs_type.replace('gfbs_main:', '')}]`);
        new Dialog({
            id:'gfbs_console_node_finder',
            title:'Find / Select Console Node',
            width:720,
            form:{node:{label:'Node',type:'select',options,value:nodes[0].uuid}},
            onConfirm(result){focusConsoleNode(nodes.find(element => element.uuid === result.node));}
        }).show();
    }

    function showSceneOverview() {
        const nodes = ConsoleNodeElement.all.slice();
        const state = getState();
        const byType = {};
        nodes.forEach(element => byType[element.gfbs_type] = (byType[element.gfbs_type] || 0) + 1);
        const validation = validateCurrentScene(false);
        const warnings = state._resource_warnings ? Object.entries(state._resource_warnings) : [];
        const detail = [
            'NODE TYPES',
            ...Object.entries(byType).sort((a,b) => a[0].localeCompare(b[0])).map(([type,count]) => `${String(count).padStart(4)}  ${type}`),
            '',
            `Bindings: ${state.bindings.length}`,
            `Connections: ${state.connections.length}`,
            `Scene properties: ${Object.keys(state.properties || {}).length}`,
            `Preview overrides: ${Object.keys(state.preview_values || {}).length}`,
            `Unresolved preview resources: ${warnings.length}`,
            '',
            validation.errors.length ? 'ERRORS' : '',
            ...validation.errors.slice(0, 30),
            validation.warnings.length ? 'WARNINGS' : '',
            ...validation.warnings.slice(0, 30)
        ].filter((line, index, array) => line !== '' || (index > 0 && array[index - 1] !== ''));
        Blockbench.showMessageBox({
            title:'GFBS Scene Overview',
            icon:validation.errors.length ? 'error' : validation.warnings.length ? 'warning' : 'check_circle',
            message:`${nodes.length} nodes · ${validation.errors.length} errors · ${validation.warnings.length} warnings`,
            detail:detail.join('\n')
        });
    }

    function uniqueRootPropertyName(base) {
        const properties = getState().properties || {};
        let name = base;
        let index = 2;
        while (Object.prototype.hasOwnProperty.call(properties, name)) name = `${base}_${index++}`;
        return name;
    }

    function createStarterConsoleTemplate() {
        const state = getState();
        const parent = getCurrentConsoleParent();
        const powerProperty = uniqueRootPropertyName('power');
        const outputProperty = uniqueRootPropertyName('output');
        Undo.initEdit({outliner:true,elements:[],selection:true});
        const common = {openEditor:false,noUndo:true,select:false,refresh:false};
        const assembly = createConsoleNode('gfbs_main:node_3d', parent, Object.assign({name:'console_assembly'}, common));
        const panel = createConsoleNode('gfbs_main:model', assembly, Object.assign({
            name:'panel',
            data:{
                source:{adapter:'gfbs_main:vanilla_json',location:'minecraft:polished_deepslate'},
                parts:{whole:'/'},
                material_profiles:{
                    off:{shading:'pbr',color:[0.35,0.35,0.35,1],fullbright:false,visible:true},
                    on:{shading:'pbr',color:[0.25,1,0.35,1],fullbright:true,visible:true}
                }
            },
            scale:[1.5,0.12,0.75]
        }, common));
        const label = createConsoleNode('gfbs_main:text', assembly, Object.assign({name:'status_label',position:[0,0.18,0.39],data:{text:'OUTPUT 000',pixel_scale:0.0045}}, common));
        const row = createConsoleNode('gfbs_main:linear_layout', assembly, Object.assign({name:'controls',position:[-0.45,0,0.42],data:{spacing:[0.3,0,0]}}, common));
        const button = createConsoleNode('gfbs_main:button', row, Object.assign({name:'action_button'}, common));
        const toggle = createConsoleNode('gfbs_main:toggle', row, Object.assign({name:'power_toggle'}, common));
        const knob = createConsoleNode('gfbs_main:knob', row, Object.assign({name:'output_knob'}, common));
        createConsoleNode('gfbs_main:slider', row, Object.assign({name:'trim_slider'}, common));
        createConsoleNode('gfbs_main:indicator', assembly, Object.assign({
            name:'power_indicator',
            data:{source:`$root.${powerProperty}`,target:`${panel.name}::whole`,states:{false:'off',true:'on'}}
        }, common));
        state.properties[powerProperty] = {type:'boolean',default:false,sync:true,save:true};
        state.properties[outputProperty] = {type:'double',default:0,sync:true,save:true,interpolate:true};
        state.bindings.push({source:`${toggle.name}.state`,target:`$root.${powerProperty}`});
        state.bindings.push({source:`${knob.name}.value`,target:`$root.${outputProperty}`,range:{input_min:0,input_max:1,output_min:0,output_max:100}});
        state.bindings.push({source:`$root.${outputProperty}`,target:`${label.name}.text`,format:'OUTPUT %03.0f'});
        state.connections.push({from:`${button.name}.activated`,action:{type:'toggle',target:`$root.${powerProperty}`}});
        state._resolved_preview_values = null;
        state._preview_definitions = null;
        assembly.select();
        refreshAllDecorations();
        Undo.finishEdit('Create GFBS starter console');
        markDirty();
        showInfo(`Created starter console assembly (${assembly.name})`);
    }

    function manageProperties(root) {
        const target = root ? getState().properties : (selectedConsoleNode() ? nodeProperties(selectedConsoleNode()) : null);
        if (!target) return;
        const keys = Object.keys(target);
        const options = {'__new__': '<New property>'};
        keys.forEach(key => options[key] = key);
        new Dialog({
            id: 'gfbs_console_property_pick',
            title: root ? 'Scene Properties' : 'Node Properties',
            form: {
                property: {label:'Property', type:'select', options, value:keys[0] || '__new__'},
                operation: {label:'Operation', type:'select', options:{edit:'Add / Edit', delete:'Delete'}, value:'edit'}
            },
            onConfirm(result) {
                if (result.operation === 'delete') {
                    if (result.property !== '__new__') {
                        delete target[result.property];
                        commitPropertyTarget(root, target);
                    }
                    return;
                }
                editProperty(root, target, result.property === '__new__' ? null : result.property);
            }
        }).show();
    }

    function editProperty(root, target, oldName) {
        const def = oldName ? target[oldName] : {type:'boolean', default:false, sync:true, save:false, interpolate:false};
        const type = normalizePropertyType(def.type || 'boolean');
        const asVec3 = Array.isArray(def.default) && def.default.length === 3 ? def.default : [0,0,0];
        const typeCondition = expected => result => normalizePropertyType((result && result.type) || type) === expected;
        const numberCondition = result => ['integer','long','double'].includes(normalizePropertyType((result && result.type) || type));
        new Dialog({
            id:'gfbs_console_property_edit', title: oldName ? `Edit Property: ${oldName}` : 'Add Property',
            form:{
                name:{label:'Name', type:'text', value:oldName || 'property'},
                type:{label:'Type', type:'select', options:{boolean:'boolean',integer:'integer',long:'long',double:'double',string:'string',color:'color',vec3:'vec3',resource:'resource'}, value:type},
                default_boolean:{label:'Default', type:'checkbox', value:!!def.default, condition:typeCondition('boolean')},
                default_number:{label:'Default', type:'number', value:Number.isFinite(Number(def.default))?Number(def.default):0, condition:numberCondition},
                default_string:{label:'Default', type:'text', value:typeof def.default==='string'?def.default:'', condition:typeCondition('string')},
                default_color:{label:'Default Color', type:'text', value:typeof def.default==='string'?def.default:'#FFFFFFFF', condition:typeCondition('color')},
                default_vec3:{label:'Default Vec3', type:'vector', dimensions:3, value:asVec3, condition:typeCondition('vec3')},
                default_resource:{label:'Default ResourceLocation', type:'text', value:typeof def.default==='string'?def.default:'minecraft:air', condition:typeCondition('resource')},
                sync:{label:'Sync', type:'checkbox', value:def.sync !== false},
                save:{label:'Save', type:'checkbox', value:!!def.save},
                interpolate:{label:'Interpolate', type:'checkbox', value:!!def.interpolate}
            },
            onConfirm(result){
                try {
                    const name = String(result.name || '').trim();
                    if (!name) throw new Error('Property name is required');
                    const propertyType = normalizePropertyType(result.type);
                    let value;
                    if (propertyType === 'boolean') value = !!result.default_boolean;
                    else if (propertyType === 'integer' || propertyType === 'long') {
                        value = Number(result.default_number);
                        if (!Number.isFinite(value)) throw new Error('Numeric default must be finite');
                        value = Math.trunc(value);
                    } else if (propertyType === 'double') {
                        value = Number(result.default_number);
                        if (!Number.isFinite(value)) throw new Error('Numeric default must be finite');
                    } else if (propertyType === 'string') value = String(result.default_string || '');
                    else if (propertyType === 'color') value = String(result.default_color || '#FFFFFFFF');
                    else if (propertyType === 'vec3') value = vector3(result.default_vec3, [0,0,0]);
                    else if (propertyType === 'resource') value = String(result.default_resource || '');
                    const candidate = {type:propertyType, default:value, sync:!!result.sync, save:!!result.save, interpolate:!!result.interpolate};
                    const errors = [];
                    validatePropertyDefinition(name, candidate, errors, root ? '$root' : (selectedConsoleNode()?.name || 'node'));
                    if (errors.length) throw new Error(errors.join('\n'));
                    if (oldName && oldName !== name) delete target[oldName];
                    target[name] = candidate;
                    commitPropertyTarget(root, target);
                } catch(error){ showError(error.message); }
            }
        }).show();
    }

    function commitPropertyTarget(root, target) {
        if (root) { getState().properties = clone(target); markDirty(); }
        else {
            const element = selectedConsoleNode();
            if (element) { element.gfbs_properties_json = pretty(target); updateElementDecoration(element); markDirty(); }
        }
    }

    function propertyAddressOptions() {
        const state = getState();
        const result = {};
        Object.keys(state.properties || {}).forEach(name => result[`$root.${name}`] = `$root.${name}`);
        ConsoleNodeElement.all.forEach(element => {
            Object.keys(propertyDefinitionsFor(element)).forEach(name => {
                result[`${element.name}.${name}`] = `${element.name}.${name}`;
            });
        });
        return result;
    }

    function manageBindings() {
        const state = getState();
        const options = {'__new__':'<New binding>'};
        state.bindings.forEach((b,i) => options[String(i)] = `${i}: ${b.source} → ${b.target}`);
        new Dialog({id:'gfbs_binding_pick', title:'GFBS Bindings', form:{
            binding:{label:'Binding', type:'select', options, value:state.bindings.length ? '0':'__new__'},
            operation:{label:'Operation', type:'select', options:{edit:'Add / Edit', map:'Edit Map Entries', delete:'Delete'}, value:'edit'}
        }, onConfirm(result){
            if (result.operation === 'delete') {
                if (result.binding !== '__new__') { state.bindings.splice(Number(result.binding),1); markDirty(); }
                return;
            }
            if (result.operation === 'map') {
                if (result.binding === '__new__') return showError('Create the binding first, then edit map entries.');
                return editBindingMap(Number(result.binding));
            }
            editBinding(result.binding === '__new__' ? -1 : Number(result.binding));
        }}).show();
    }
    function editBinding(index) {
        const state = getState();
        const original = index >= 0 ? clone(state.bindings[index]) : {source:'', target:''};
        const addresses = propertyAddressOptions();
        const addressOptions = {'__custom__':'<Custom address>', ...addresses};
        const transform = original.map ? 'map' : original.range ? 'range' : original.format ? 'format' : 'direct';
        const transformIs = expected => result => String((result && result.transform) || transform) === expected;
        new Dialog({id:'gfbs_binding_edit', title:index>=0?'Edit Binding':'Add Binding', width:600, form:{
            source:{label:'Source', type:'select', options:addressOptions, value:addresses[original.source] ? original.source : '__custom__'},
            source_custom:{label:'Custom Source', type:'text', value:addresses[original.source] ? '' : (original.source || '')},
            target:{label:'Target', type:'select', options:addressOptions, value:addresses[original.target] ? original.target : '__custom__'},
            target_custom:{label:'Custom Target', type:'text', value:addresses[original.target] ? '' : (original.target || '')},
            transform:{label:'Transform', type:'select', options:{direct:'Direct',map:'Map',range:'Numeric Range',format:'Format'}, value:transform},
            map_hint:{label:'Map',type:'info',text:'Save this binding, then choose “Edit Map Entries” to edit source-key → value mappings without JSON.',condition:transformIs('map')},
            input_min:{label:'Input Min', type:'number', value:original.range ? finiteNumber(original.range.input_min,0):0,condition:transformIs('range')},
            input_max:{label:'Input Max', type:'number', value:original.range ? finiteNumber(original.range.input_max,1):1,condition:transformIs('range')},
            output_min:{label:'Output Min', type:'number', value:original.range ? finiteNumber(original.range.output_min,0):0,condition:transformIs('range')},
            output_max:{label:'Output Max', type:'number', value:original.range ? finiteNumber(original.range.output_max,1):1,condition:transformIs('range')},
            format_string:{label:'Format String', type:'text', value:original.format || '%s',condition:transformIs('format')}
        }, onConfirm(result){
            try {
                const passthrough = Object.fromEntries(Object.entries(original).filter(([key]) => !['source','target','map','range','format'].includes(key)));
                const binding = Object.assign({}, passthrough, {
                    source: result.source === '__custom__' ? String(result.source_custom||'') : result.source,
                    target: result.target === '__custom__' ? String(result.target_custom||'') : result.target
                });
                if (!parseAddress(binding.source) || !parseAddress(binding.target)) throw new Error('Source and target must be property addresses: node.property');
                if (result.transform === 'map') binding.map = clone(original.map || {});
                if (result.transform === 'range') binding.range = {input_min:Number(result.input_min), input_max:Number(result.input_max), output_min:Number(result.output_min), output_max:Number(result.output_max)};
                if (result.transform === 'format') binding.format = String(result.format_string || '%s');
                let savedIndex=index;
                if (index >= 0) state.bindings[index] = binding;
                else { state.bindings.push(binding); savedIndex=state.bindings.length-1; }
                markDirty();
                if (result.transform === 'map') setTimeout(()=>editBindingMap(savedIndex), 0);
            } catch(error){ showError(error.message); }
        }}).show();
    }
    function editBindingMap(index) {
        const state = getState();
        const binding = state.bindings[index];
        if (!binding) return showError('Binding no longer exists');
        if (!binding.map || typeof binding.map !== 'object' || Array.isArray(binding.map)) binding.map = {};
        const keys = Object.keys(binding.map);
        const options = {'__new__':'<New map entry>'};
        keys.forEach(key => options[key] = `${key} → ${Array.isArray(binding.map[key]) ? '['+binding.map[key].join(', ')+']' : String(binding.map[key])}`);
        new Dialog({id:'gfbs_binding_map_pick',title:`Binding Map: ${binding.source} → ${binding.target}`,form:{
            entry:{label:'Entry',type:'select',options,value:keys[0]||'__new__'},
            operation:{label:'Operation',type:'select',options:{edit:'Add / Edit',delete:'Delete'},value:'edit'}
        },onConfirm(result){
            if(result.operation==='delete'){
                if(result.entry!=='__new__') { delete binding.map[result.entry]; markDirty(); }
                return;
            }
            const oldKey=result.entry==='__new__'?null:result.entry;
            const oldValue=oldKey!==null?binding.map[oldKey]:'';
            const preferred=propertyDefinitionForAddress(binding.target);
            const form={
                key:{label:'Source mapping key',type:'text',value:oldKey||'true'},
                ...typedLiteralForm('mapped',oldValue,preferred&&preferred.type)
            };
            new Dialog({id:'gfbs_binding_map_edit',title:oldKey?'Edit Map Entry':'Add Map Entry',form,onConfirm(r){
                try{
                    const key=String(r.key??'').trim(); if(!key)throw new Error('Mapping key is required');
                    const value=readTypedLiteral(r,'mapped',preferred&&preferred.type);
                    if(oldKey&&oldKey!==key)delete binding.map[oldKey];
                    binding.map[key]=value; markDirty();
                }catch(error){showError(error.message);}
            }}).show();
        }}).show();
    }

    function signalOptions() {
        const result = {'__custom__':'<Custom signal>'};
        ConsoleNodeElement.all.forEach(element => {
            const signals = [];
            if (INTERACTION_TYPES.has(element.gfbs_type)) {
                signals.push('pressed','released','activated','drag_started','dragged','drag_ended','scrolled');
                if (['gfbs_main:toggle','gfbs_main:lever'].includes(element.gfbs_type)) signals.push('toggled');
                if (['gfbs_main:knob','gfbs_main:lever','gfbs_main:slider'].includes(element.gfbs_type)) signals.push('changed');
            }
            if (element.gfbs_type === 'gfbs_main:timer') signals.push('elapsed');
            signals.forEach(signal => result[`${element.name}.${signal}`] = `${element.name}.${signal}`);
        });
        return result;
    }

    function manageConnections() {
        const state = getState();
        const options = {'__new__':'<New connection>'};
        state.connections.forEach((c,i) => options[String(i)] = `${i}: ${c.from} → ${c.action && c.action.type || '?'}`);
        new Dialog({id:'gfbs_connection_pick',title:'GFBS Connections',form:{
            connection:{label:'Connection',type:'select',options,value:state.connections.length?'0':'__new__'},
            operation:{label:'Operation',type:'select',options:{edit:'Add / Edit',delete:'Delete'},value:'edit'}
        },onConfirm(result){
            if(result.operation==='delete'){if(result.connection!=='__new__'){state.connections.splice(Number(result.connection),1);markDirty();}return;}
            editConnection(result.connection==='__new__'?-1:Number(result.connection));
        }}).show();
    }

    function editConnection(index) {
        const state = getState();
        const original = index>=0?clone(state.connections[index]):{from:'',action:{type:'set',target:'$root.power',value:true}};
        const action = original.action || {};
        const actionTypeText=String(action.type||'set');
        const canonicalBuiltin=actionTypeText.startsWith('gfbs_main:')?actionTypeText.substring('gfbs_main:'.length):actionTypeText;
        const builtin = ['set','toggle','emit','host'].includes(canonicalBuiltin) ? canonicalBuiltin : 'custom';
        const signals = signalOptions();
        const addresses = {'__custom__':'<Custom property address>', ...propertyAddressOptions()};
        const emitTargets = signalOptions();
        const actionIs = (...types) => result => types.includes(String((result&&result.action_type)||builtin));
        const targetAddress = action.target || '';
        const preferred = propertyDefinitionForAddress(targetAddress);
        const includeValue = Object.prototype.hasOwnProperty.call(action,'value');
        const valueCondition = result => {
            const type=String((result&&result.action_type)||builtin);
            return type==='set' || (type==='host' && !!(result&&result.has_value));
        };
        const form={
            from:{label:'From signal',type:'select',options:signals,value:signals[original.from]?original.from:'__custom__'},
            from_custom:{label:'Custom signal node.signal',type:'text',value:signals[original.from]?'':(original.from||'')},
            action_type:{label:'Action',type:'select',options:{set:'set',toggle:'toggle',emit:'emit',host:'host',custom:'Custom action type'},value:builtin},
            target:{label:'Property Target',type:'select',options:addresses,value:addresses[targetAddress]?targetAddress:'__custom__',condition:actionIs('set','toggle')},
            target_custom:{label:'Custom Property Target',type:'text',value:addresses[targetAddress]?'':targetAddress,condition:actionIs('set','toggle')},
            emit_target:{label:'Emit Target',type:'select',options:emitTargets,value:emitTargets[targetAddress]?targetAddress:'__custom__',condition:actionIs('emit')},
            emit_target_custom:{label:'Custom emit node.signal',type:'text',value:emitTargets[targetAddress]?'':targetAddress,condition:actionIs('emit')},
            host_id:{label:'Host Action ID',type:'text',value:action.id||'gfbs_main:action',condition:actionIs('host')},
            custom_type:{label:'Custom Action Type',type:'text',value:builtin==='custom'?actionTypeText:'',condition:actionIs('custom')},
            has_value:{label:'Use literal payload instead of incoming signal payload',type:'checkbox',value:includeValue,condition:actionIs('host')},
            ...typedLiteralForm('literal',Object.prototype.hasOwnProperty.call(action,'value')?action.value:true,preferred&&preferred.type,valueCondition)
        };
        new Dialog({id:'gfbs_connection_edit',title:index>=0?'Edit Connection':'Add Connection',width:640,form,onConfirm(result){
            try{
                const from=result.from==='__custom__'?String(result.from_custom||'').trim():String(result.from||'').trim();
                const sep=from.lastIndexOf('.'); if(sep<=0||sep>=from.length-1)throw new Error('Signal source must be node.signal');
                let type=result.action_type==='custom'?String(result.custom_type||'').trim():String(result.action_type||'').trim();
                if(!type)throw new Error('Action type is required');
                if(result.action_type==='custom'&&!parseResourceLocation(type))throw new Error('Custom action type must be a namespaced ResourceLocation');
                const passthrough=Object.fromEntries(Object.entries(action).filter(([key])=>!['type','target','id','value'].includes(key)));
                const a=Object.assign({},passthrough,{type});
                if(result.action_type==='set'||result.action_type==='toggle'){
                    a.target=result.target==='__custom__'?String(result.target_custom||'').trim():String(result.target||'').trim();
                    if(!parseAddress(a.target))throw new Error('Property target must be node.property');
                }else if(result.action_type==='emit'){
                    a.target=result.emit_target==='__custom__'?String(result.emit_target_custom||'').trim():String(result.emit_target||'').trim();
                    const targetSep=a.target.lastIndexOf('.'); if(targetSep<=0||targetSep>=a.target.length-1)throw new Error('Emit target must be node.signal');
                }else if(result.action_type==='host'){
                    a.id=String(result.host_id||'').trim(); if(!parseResourceLocation(a.id))throw new Error('Host Action ID must be a valid ResourceLocation');
                }
                if(result.action_type==='set'){
                    const targetDef=propertyDefinitionForAddress(a.target);
                    a.value=readTypedLiteral(result,'literal',targetDef&&targetDef.type);
                }else if(result.action_type==='host'&&result.has_value){
                    a.value=readTypedLiteral(result,'literal',null);
                }
                const connection={from,action:a};
                if(index>=0)state.connections[index]=connection;else state.connections.push(connection); markDirty();
            }catch(error){showError(error.message);}
        }}).show();
    }
    function manageModelParts() {
        const element=selectedConsoleNode(); if(!element||element.gfbs_type!=='gfbs_main:model')return showInfo('Select a model node first');
        const data=nodeData(element); data.parts=data.parts&&typeof data.parts==='object'?data.parts:{};
        const keys=Object.keys(data.parts); const options={'__new__':'<New alias>'}; keys.forEach(k=>options[k]=`${k} → ${data.parts[k]}`);
        const source=data.source||{}; const modelPath=source.adapter==='gfbs_main:gltf'?resolveAssetLocation(source.location):null;
        new Dialog({id:'gfbs_part_pick',title:`Model Parts: ${element.name}`,form:{
            alias:{label:'Alias',type:'select',options,value:keys[0]||'__new__'},
            operation:{label:'Operation',type:'select',options:{edit:'Add / Edit',delete:'Delete',scan:'Scan glTF node names'},value:'edit'}
        },onConfirm(result){
            if(result.operation==='delete'){if(result.alias!=='__new__')delete data.parts[result.alias]; element.gfbs_data_json=pretty(data);markDirty();return;}
            if(result.operation==='scan'){
                if(!modelPath||!fs||!fs.existsSync(modelPath))return showError('glTF file could not be resolved. Set Workspace Root if needed.');
                const parts=listGltfParts(modelPath); Blockbench.showMessageBox({title:'glTF Parts',message:`Found ${parts.length} named nodes`,detail:parts.join('\n')}); return;
            }
            editModelPart(element,data,result.alias==='__new__'?null:result.alias,modelPath);
        }}).show();
    }

    function editModelPart(element,data,oldAlias,modelPath){
        const parts=modelPath&&fs&&fs.existsSync(modelPath)?listGltfParts(modelPath):[];
        const options={'__custom__':'<Custom path/name>'}; parts.forEach(p=>options[p]=p);
        const oldPath=oldAlias?data.parts[oldAlias]:'';
        new Dialog({id:'gfbs_part_edit',title:oldAlias?'Edit Part Alias':'Add Part Alias',form:{
            alias:{label:'Alias',type:'text',value:oldAlias||'part'},
            part:{label:'glTF Part',type:'select',options,value:parts.includes(oldPath)?oldPath:'__custom__'},
            custom:{label:'Custom Part Path/Name',type:'text',value:parts.includes(oldPath)?'':oldPath}
        },onConfirm(result){
            const alias=String(result.alias||'').trim(); if(!alias)return showError('Alias is required');
            const target=result.part==='__custom__'?String(result.custom||''):result.part; if(!target)return showError('Part path/name is required');
            if(oldAlias&&oldAlias!==alias)delete data.parts[oldAlias]; data.parts[alias]=target; element.gfbs_data_json=pretty(data); updateElementDecoration(element); markDirty();
        }}).show();
    }

    function manageMaterialProfiles(){
        const element=selectedConsoleNode(); if(!element||element.gfbs_type!=='gfbs_main:model')return showInfo('Select a model node first');
        const data=nodeData(element); data.material_profiles=data.material_profiles&&typeof data.material_profiles==='object'?data.material_profiles:{};
        const keys=Object.keys(data.material_profiles); const options={'__new__':'<New profile>'}; keys.forEach(k=>options[k]=k);
        new Dialog({id:'gfbs_material_pick',title:`Material Profiles: ${element.name}`,form:{
            profile:{label:'Profile',type:'select',options,value:keys[0]||'__new__'},
            operation:{label:'Operation',type:'select',options:{edit:'Add / Edit',delete:'Delete'},value:'edit'}
        },onConfirm(result){
            if(result.operation==='delete'){if(result.profile!=='__new__')delete data.material_profiles[result.profile]; element.gfbs_data_json=pretty(data);markDirty();return;}
            editMaterialProfile(element,data,result.profile==='__new__'?null:result.profile);
        }}).show();
    }

    function editMaterialProfile(element,data,oldName){
        const def=oldName?data.material_profiles[oldName]:{};
        const color=def.color||[1,1,1,1]; const emissive=def.emissive_color||[0,0,0];
        new Dialog({id:'gfbs_material_edit',title:oldName?`Edit Material: ${oldName}`:'Add Material Profile',form:{
            name:{label:'Name',type:'text',value:oldName||'profile'},
            shading:{label:'Shading',type:'select',options:{pbr:'PBR',unlit:'Unlit',neon:'Neon'},value:String(def.shading||'pbr').toLowerCase()},
            color:{label:'Color',type:'color',value:rgbArrayToHex(color)},
            alpha:{label:'Alpha',type:'number',value:def.alpha!==undefined?finiteNumber(def.alpha,1):finiteNumber(color[3],1),min:0,max:1,step:0.05},
            emissive_color:{label:'Emissive Color',type:'color',value:rgbArrayToHex(emissive,'#000000')},
            emissive_strength:{label:'Emissive Strength',type:'number',value:finiteNumber(def.emissive_strength,0),min:0,step:0.1},
            neon_strength:{label:'Neon Strength',type:'number',value:finiteNumber(def.neon_strength,1),min:0,step:0.1},
            fullbright:{label:'Fullbright',type:'checkbox',value:!!def.fullbright},
            visible:{label:'Visible',type:'checkbox',value:def.visible!==false}
        },onConfirm(result){
            const name=String(result.name||'').trim();if(!name)return showError('Material profile name is required');
            const profile={shading:result.shading,color:hexToRgbArray(result.color,Number(result.alpha)),emissive_color:hexToRgbArray(result.emissive_color),emissive_strength:Number(result.emissive_strength),neon_strength:Number(result.neon_strength),fullbright:!!result.fullbright,visible:!!result.visible};
            if(oldName&&oldName!==name)delete data.material_profiles[oldName]; data.material_profiles[name]=profile; element.gfbs_data_json=pretty(data); updateElementDecoration(element); markDirty();
        }}).show();
    }

    function manageInteractionShape(){
        const element=selectedConsoleNode();
        if(!element||!INTERACTION_TYPES.has(element.gfbs_type))return showInfo('Select an interaction/control node first');
        const data=nodeData(element);
        const interaction=data.interaction&&typeof data.interaction==='object'&&!Array.isArray(data.interaction)?data.interaction:{};
        const shape=interaction.shape&&typeof interaction.shape==='object'?interaction.shape:{type:'box',center:[0,0,0],size:[0.25,0.2,0.12]};
        const current=String(shape.type||'box').toLowerCase();
        const shapeIs=(...types)=>result=>types.includes(String((result&&result.shape_type)||current).toLowerCase());
        new Dialog({id:'gfbs_interaction_shape',title:`Interaction Shape: ${element.name}`,width:560,form:{
            shape_type:{label:'Shape',type:'select',options:{box:'Box / OBB',sphere:'Sphere',cylinder:'Cylinder (local Y)',plane_rect:'Plane Rectangle (local XY)'},value:['aabb','obb'].includes(current)?'box':current},
            center:{label:'Center (blocks)',type:'vector',dimensions:3,value:vector3(shape.center,[0,0,0])},
            size:{label:'Box Size',type:'vector',dimensions:3,value:vector3(shape.size,[0.25,0.2,0.12]),condition:shapeIs('box')},
            radius:{label:'Radius',type:'number',value:finiteNumber(shape.radius,0.125),min:0.000001,step:0.01,condition:shapeIs('sphere','cylinder')},
            height:{label:'Height',type:'number',value:finiteNumber(shape.height,0.25),min:0.000001,step:0.01,condition:shapeIs('cylinder','plane_rect')},
            width:{label:'Width',type:'number',value:finiteNumber(shape.width,0.25),min:0.000001,step:0.01,condition:shapeIs('plane_rect')},
            thickness:{label:'Thickness',type:'number',value:finiteNumber(shape.thickness,0.01),min:0.000001,step:0.001,condition:shapeIs('plane_rect')}
        },onConfirm(result){
            try{
                const type=String(result.shape_type||'box');
                const next={type,center:vector3(result.center,[0,0,0])};
                if(type==='box'){
                    next.size=vector3(result.size,[0.25,0.2,0.12]).map(Number);
                    if(next.size.some(v=>!Number.isFinite(v)||v<=0))throw new Error('Box size components must be positive');
                }else if(type==='sphere'){
                    next.radius=Number(result.radius); if(!Number.isFinite(next.radius)||next.radius<=0)throw new Error('Radius must be positive');
                }else if(type==='cylinder'){
                    next.radius=Number(result.radius); next.height=Number(result.height);
                    if(!Number.isFinite(next.radius)||next.radius<=0||!Number.isFinite(next.height)||next.height<=0)throw new Error('Cylinder radius/height must be positive');
                }else{
                    next.width=Number(result.width); next.height=Number(result.height); next.thickness=Number(result.thickness);
                    if(!Number.isFinite(next.width)||next.width<=0||!Number.isFinite(next.height)||next.height<=0||!Number.isFinite(next.thickness)||next.thickness<=0)throw new Error('Plane width/height/thickness must be positive');
                }
                interaction.shape=next; if(interaction.max_distance===undefined)interaction.max_distance=5; data.interaction=interaction;
                Undo.initEdit({elements:[element]});
                element.gfbs_data_json=pretty(data); updateElementDecoration(element); refreshAllTransforms();
                Undo.finishEdit('Edit GFBS interaction shape'); markDirty();
            }catch(error){showError(error.message);}
        }}).show();
    }

    function manageIndicatorStates(){
        const element=selectedConsoleNode();
        if(!element||element.gfbs_type!=='gfbs_main:indicator')return showInfo('Select an indicator node first');
        const data=nodeData(element); data.states=data.states&&typeof data.states==='object'&&!Array.isArray(data.states)?data.states:{};
        const keys=Object.keys(data.states); const options={'__new__':'<New state mapping>'}; keys.forEach(k=>options[k]=`${k} → ${data.states[k]}`);
        new Dialog({id:'gfbs_indicator_state_pick',title:`Indicator States: ${element.name}`,form:{
            state:{label:'State key',type:'select',options,value:keys[0]||'__new__'},
            operation:{label:'Operation',type:'select',options:{edit:'Add / Edit',delete:'Delete'},value:'edit'}
        },onConfirm(result){
            if(result.operation==='delete'){
                if(result.state!=='__new__')delete data.states[result.state];
                element.gfbs_data_json=pretty(data); markDirty(); return;
            }
            const old=result.state==='__new__'?null:result.state;
            const target=String(data.target||''); const sep=target.indexOf('::');
            const modelId=sep>0?target.substring(0,sep):''; const model=ConsoleNodeElement.all.find(e=>e.name===modelId&&e.gfbs_type==='gfbs_main:model');
            const profiles=model?Object.keys((nodeData(model).material_profiles)||{}):[];
            const profileOptions={'__custom__':'<Custom profile>'}; profiles.forEach(p=>profileOptions[p]=p);
            const oldProfile=old?data.states[old]:'';
            new Dialog({id:'gfbs_indicator_state_edit',title:old?'Edit Indicator State':'Add Indicator State',form:{
                key:{label:'Source mapping key',type:'text',value:old||'true'},
                profile:{label:'Material Profile',type:'select',options:profileOptions,value:profiles.includes(oldProfile)?oldProfile:'__custom__'},
                profile_custom:{label:'Custom Profile',type:'text',value:profiles.includes(oldProfile)?'':oldProfile}
            },onConfirm(r){
                const key=String(r.key??'').trim(); if(!key)return showError('State mapping key is required');
                const profile=r.profile==='__custom__'?String(r.profile_custom||'').trim():r.profile; if(!profile)return showError('Material profile is required');
                if(old&&old!==key)delete data.states[old]; data.states[key]=profile; element.gfbs_data_json=pretty(data); markDirty();
            }}).show();
        }}).show();
    }

    function fitHitbox(){
        const element=selectedConsoleNode(); if(!element||!INTERACTION_TYPES.has(element.gfbs_type))return showInfo('Select an interaction/control node first');
        let box=new THREE.Box3(); let found=false;
        const includeGeometry=root=>{
            if(!root||!root.traverse)return;
            root.traverse(object=>{
                if(!object||object.visible===false||!object.geometry||(object.userData&&object.userData.gfbsSelectionProxy))return;
                if(object.userData&&object.userData.gfbsHelper)return;
                const objectBox=new THREE.Box3().setFromObject(object);
                if(!objectBox.isEmpty()){box.union(objectBox);found=true;}
            });
        };
        (element.children||[]).forEach(child=>{if(child instanceof ConsoleNodeElement&&child.mesh)includeGeometry(child.mesh);});
        if(!found&&element.mesh)includeGeometry(element.mesh);
        if(!found)return showError('No visible geometry found to fit hitbox');
        const inv=new THREE.Matrix4().copy(element.mesh.matrixWorld).invert();
        const corners=[]; for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z).applyMatrix4(inv));
        const local=new THREE.Box3().setFromPoints(corners); const size=new THREE.Vector3(),center=new THREE.Vector3(); local.getSize(size);local.getCenter(center);
        const data=nodeData(element); const interaction=data.interaction&&typeof data.interaction==='object'?data.interaction:{};
        interaction.shape={type:'box',center:[center.x/BB_UNITS_PER_BLOCK,center.y/BB_UNITS_PER_BLOCK,center.z/BB_UNITS_PER_BLOCK],size:[Math.max(size.x/BB_UNITS_PER_BLOCK,0.001),Math.max(size.y/BB_UNITS_PER_BLOCK,0.001),Math.max(size.z/BB_UNITS_PER_BLOCK,0.001)]};
        if(interaction.max_distance===undefined)interaction.max_distance=5; data.interaction=interaction; element.gfbs_data_json=pretty(data); updateElementDecoration(element); markDirty(); showInfo('Interaction hitbox fitted to visible geometry');
    }

    function forcedControlType(element) {
        const type = element.gfbs_type;
        if (type === 'gfbs_main:button') return 'MOMENTARY';
        if (type === 'gfbs_main:toggle') return 'TOGGLE';
        if (type === 'gfbs_main:knob') return 'KNOB';
        if (type === 'gfbs_main:lever') return 'LEVER';
        if (type === 'gfbs_main:slider') return 'SLIDER';
        const data = nodeData(element);
        return String(data.control || 'GENERIC').toUpperCase();
    }

    function previewSet(address, value) {
        const state = getState();
        const def = allPreviewDefinitions()[address];
        state.preview_values[address] = def ? coercePreviewValue(value, def.type) : clone(value);
        state._resolved_preview_values = null;
    }

    function sanitizePreviewControlValue(element, value) {
        const interaction = interactionObject(nodeData(element));
        const min = finiteNumber(interaction.min, 0);
        const max = finiteNumber(interaction.max, 1);
        const step = Math.max(0, finiteNumber(interaction.step, 0));
        let result = Math.max(min, Math.min(max, finiteNumber(value, 0)));
        if (step > 0) {
            result = min + Math.round((result - min) / step) * step;
            result = Math.max(min, Math.min(max, result));
        }
        return result;
    }

    function runPreviewSignalQueue(initial, log) {
        const state = getState();
        const queue = [initial];
        let processed = 0;
        while (queue.length && processed++ < 256) {
            const invocation = queue.shift();
            for (const connection of (state.connections || [])) {
                if (!connection || connection.from !== `${invocation.node}.${invocation.signal}`) continue;
                const action = connection.action || {};
                const rawType = String(action.type || '');
                const actionType = rawType.includes(':') ? rawType : `gfbs_main:${rawType}`;
                if (actionType === 'gfbs_main:set') {
                    previewSet(action.target, clone(action.value));
                    log.push(`set ${action.target} = ${JSON.stringify(action.value)}`);
                } else if (actionType === 'gfbs_main:toggle') {
                    resolvePreviewValues();
                    const before = !!previewValue(action.target, false);
                    previewSet(action.target, !before);
                    log.push(`toggle ${action.target} -> ${!before}`);
                } else if (actionType === 'gfbs_main:emit') {
                    const target = String(action.target || '');
                    const split = target.lastIndexOf('.');
                    if (split > 0) queue.push({node:target.substring(0,split),signal:target.substring(split+1),payload:clone(invocation.payload)});
                    log.push(`emit ${target}`);
                } else if (actionType === 'gfbs_main:host') {
                    log.push(`HOST ${action.id || '<missing>'} payload=${JSON.stringify(Object.prototype.hasOwnProperty.call(action,'value')?action.value:invocation.payload)}`);
                } else {
                    log.push(`CUSTOM ${actionType} payload=${JSON.stringify(invocation.payload)}`);
                }
                state._resolved_preview_values = null;
                resolvePreviewValues();
            }
        }
        if (processed > 256) log.push('Signal action budget exceeded (256)');
    }

    function simulateInteraction(element, interactionType, payload) {
        if (!element || !INTERACTION_TYPES.has(element.gfbs_type)) return showInfo('Select an interaction/control node first');
        resolvePreviewValues();
        if (previewValue(`${element.name}.enabled`, true) === false) return showInfo(`${element.name} is disabled in Preview State`);
        const control = forcedControlType(element);
        const kind = String(interactionType || 'ACTIVATE').toUpperCase();
        const interaction = interactionObject(nodeData(element));
        let acceptedPayload = payload;
        const signals = [];

        if (kind === 'PRESS') {
            previewSet(`${element.name}.state`, true);
            acceptedPayload = payload === undefined ? true : payload;
        } else if (kind === 'RELEASE') {
            previewSet(`${element.name}.state`, false);
            acceptedPayload = payload === undefined ? false : payload;
        } else if ((control === 'TOGGLE' || control === 'LEVER') && kind === 'ACTIVATE') {
            resolvePreviewValues();
            const next = !previewValue(`${element.name}.state`, false);
            acceptedPayload = next;
            previewSet(`${element.name}.state`, next);
            if (control === 'LEVER') {
                const position = next ? finiteNumber(interaction.max, 1) : finiteNumber(interaction.min, 0);
                previewSet(`${element.name}.value`, position);
                signals.push({signal:'changed',payload:position});
            }
        } else if (['KNOB','SLIDER','LEVER'].includes(control) && ['SCROLL','DRAG'].includes(kind)) {
            resolvePreviewValues();
            const numericPayload = finiteNumber(payload, 0);
            let candidate;
            if (kind === 'SCROLL') {
                const current = finiteNumber(previewValue(`${element.name}.value`, 0), 0);
                const step = finiteNumber(interaction.step, 0);
                candidate = current + numericPayload * (step > 0 ? step : (finiteNumber(interaction.max,1)-finiteNumber(interaction.min,0))/20);
            } else candidate = numericPayload;
            acceptedPayload = sanitizePreviewControlValue(element, candidate);
            previewSet(`${element.name}.value`, acceptedPayload);
            signals.push({signal:'changed',payload:acceptedPayload});
        }

        const signalName = {
            PRESS:'pressed', RELEASE:'released', ACTIVATE:'activated', DRAG_START:'drag_started', DRAG:'dragged', DRAG_END:'drag_ended', SCROLL:'scrolled'
        }[kind];
        if (!signalName) return showError(`Unknown interaction type ${kind}`);
        signals.push({signal:signalName,payload:acceptedPayload});
        if ((control === 'TOGGLE' || control === 'LEVER') && kind === 'ACTIVATE') signals.push({signal:'toggled',payload:acceptedPayload});

        const log = [`${element.name} ${kind} payload=${JSON.stringify(acceptedPayload)}`];
        for (const signal of signals) {
            resolvePreviewValues();
            runPreviewSignalQueue({node:element.name,signal:signal.signal,payload:signal.payload},log);
        }
        resolvePreviewValues();
        if (THREE && typeof THREE.Group === 'function') refreshAllDecorations();
        if (log.some(line => line.startsWith('HOST ') || line.startsWith('CUSTOM '))) {
            Blockbench.showMessageBox({title:'GFBS Interaction Simulation',message:'Simulation completed. External actions are not executed inside Blockbench.',detail:log.join('\n')});
        } else showInfo(`${element.name}: ${kind} simulated`);
        return log;
    }

    function simulateSelectedActivate() {
        const element = selectedConsoleNode();
        if (!element || !INTERACTION_TYPES.has(element.gfbs_type)) return showInfo('Select a button/toggle/knob/lever/slider first');
        simulateInteraction(element, 'ACTIVATE', true);
    }

    function simulateSelectedInteraction() {
        const element = selectedConsoleNode();
        if (!element || !INTERACTION_TYPES.has(element.gfbs_type)) return showInfo('Select a button/toggle/knob/lever/slider first');
        new Dialog({id:'gfbs_console_simulate_interaction',title:`Simulate: ${element.name}`,width:520,form:{
            interaction:{label:'Interaction',type:'select',options:{ACTIVATE:'ACTIVATE',PRESS:'PRESS',RELEASE:'RELEASE',SCROLL:'SCROLL',DRAG_START:'DRAG_START',DRAG:'DRAG',DRAG_END:'DRAG_END'},value:'ACTIVATE'},
            payload:{label:'Numeric Payload (SCROLL / DRAG)',type:'number',value:0,step:0.05}
        },onConfirm(result){simulateInteraction(element,result.interaction,result.interaction==='ACTIVATE'?true:Number(result.payload));}}).show();
    }

    function previewValueOptions() {
        const defs = allPreviewDefinitions();
        const options = {};
        Object.keys(defs).sort().forEach(address => {
            const type = normalizePropertyType(defs[address].type || '');
            options[address] = `${address}  [${type || '?'}]`;
        });
        return options;
    }

    function normalizeEditablePreviewValue(value, type) {
        if (normalizePropertyType(type) !== 'color' || typeof value !== 'number') return value;
        return '#' + (value >>> 0).toString(16).padStart(8, '0').toUpperCase();
    }

    function editPreviewValue(address) {
        const state = getState();
        const defs = allPreviewDefinitions();
        const def = defs[address];
        if (!def) return showError(`Unknown preview property ${address}`);
        resolvePreviewValues();
        const resolved = state._resolved_preview_values && state._resolved_preview_values[address];
        const current = Object.prototype.hasOwnProperty.call(state.preview_values || {}, address)
            ? state.preview_values[address] : resolved;
        const form = typedLiteralForm('preview', normalizeEditablePreviewValue(current, def.type), def.type);
        new Dialog({
            id:'gfbs_console_preview_value',
            title:`Preview State: ${address}`,
            width:540,
            form,
            onConfirm(result) {
                try {
                    const value = readTypedLiteral(result, 'preview', def.type);
                    state.preview_values[address] = coercePreviewValue(value, def.type);
                    state._resolved_preview_values = null;
                    resolvePreviewValues();
                    refreshAllDecorations();
                    showInfo(`${address} = ${JSON.stringify(state.preview_values[address])}`);
                } catch (error) { showError(error.message); }
            }
        }).show();
    }

    function managePreviewState() {
        const state = getState();
        const options = previewValueOptions();
        const addresses = Object.keys(options);
        if (!addresses.length) return showInfo('This scene exposes no known preview properties');
        new Dialog({
            id:'gfbs_console_preview_state',
            title:'GFBS Preview Runtime State',
            width:620,
            form:{
                property:{label:'Property',type:'select',options,value:addresses[0]},
                operation:{label:'Operation',type:'select',options:{edit:'Set Preview Override',reset:'Reset Selected Override',reset_all:'Reset All Overrides'},value:'edit'}
            },
            onConfirm(result) {
                if (result.operation === 'reset_all') {
                    state.preview_values = {};
                    state._resolved_preview_values = null;
                    refreshAllDecorations();
                    showInfo('Preview state reset to scene defaults');
                } else if (result.operation === 'reset') {
                    delete state.preview_values[result.property];
                    state._resolved_preview_values = null;
                    refreshAllDecorations();
                    showInfo(`Reset ${result.property}`);
                } else editPreviewValue(result.property);
            }
        }).show();
    }

    function showPreviewRuntimeSnapshot() {
        const values = resolvePreviewValues();
        const state = getState();
        const overrides = state.preview_values || {};
        const lines = Object.keys(values).sort().map(address => `${Object.prototype.hasOwnProperty.call(overrides,address) ? '●' : ' '} ${address} = ${JSON.stringify(values[address])}`);
        Blockbench.showMessageBox({
            title:'GFBS Preview Runtime Snapshot',
            message:`${lines.length} resolved properties (${Object.keys(overrides).length} override(s))`,
            detail:lines.join('\n') || '(empty)'
        });
    }

    function setMinecraftAssetsDirectory(){
        if(!Blockbench.pickDirectory)return showError('This Blockbench build does not expose directory selection');
        const chosen=Blockbench.pickDirectory({resource_id:'gfbs_console_mc_assets',title:'Select folder containing assets/minecraft'});
        if(!chosen)return;
        const normalized=normalizeResourceDirectory(chosen);
        if(!normalized||!fs.existsSync(path.join(normalized,'assets','minecraft')))return showError('Selected directory does not contain assets/minecraft');
        const state=getState(); state.minecraft_asset_source=normalized; saveGlobalSettings({minecraft_asset_source:normalized}); clearPreviewCaches(); refreshAllDecorations(); showInfo(`Minecraft assets: ${normalized}`);
    }

    function setMinecraftClientJar(){
        Blockbench.import({resource_id:'gfbs_console_mc_jar',type:'Minecraft Client JAR',extensions:['jar','zip'],readtype:'none',multiple:false},files=>{
            const file=files&&files[0]; if(!file||!file.path)return;
            try{
                const directory=zipDirectory(file.path);
                if(!directory||!directory.entries.has('assets/minecraft/models/block/cube_all.json'))throw new Error('The selected archive does not look like a Minecraft client/resource JAR');
                const state=getState(); state.minecraft_asset_source=file.path; saveGlobalSettings({minecraft_asset_source:file.path}); clearPreviewCaches(); refreshAllDecorations(); showInfo(`Minecraft JAR: ${path.basename(file.path)}`);
            }catch(error){showError(error.message);}
        });
    }

    function autoDetectMinecraftAssets(){
        autoMinecraftCandidatesCache = null;
        const candidates=autoMinecraftAssetCandidates();
        if(!candidates.length)return showError('No local Minecraft 1.20.1 client asset JAR was found. Studio will keep using approximate block previews; use “Set Minecraft Client JAR...” for exact vanilla textures.');
        const selected=candidates[0];
        const state=getState(); state.minecraft_asset_source=selected; saveGlobalSettings({minecraft_asset_source:selected}); clearPreviewCaches(); refreshAllDecorations(); showInfo(`Auto-detected Minecraft assets: ${path.basename(selected)}`);
    }

    function addResourceRoot(){
        if(!Blockbench.pickDirectory)return showError('This Blockbench build does not expose directory selection');
        const chosen=Blockbench.pickDirectory({resource_id:'gfbs_console_resource_root',title:'Add Resource Pack / resources Root'});
        if(!chosen)return;
        const normalized=normalizeResourceDirectory(chosen);
        if(!normalized)return showError('Select a directory containing assets/ (or a Forge project root with src/main/resources/assets)');
        const state=getState();
        state.resource_roots=Array.isArray(state.resource_roots)?state.resource_roots:[];
        if(!state.resource_roots.includes(normalized))state.resource_roots.push(normalized);
        saveGlobalSettings({resource_roots:state.resource_roots.slice()});
        clearPreviewCaches(); refreshAllDecorations(); showInfo(`Added resource root: ${normalized}`);
    }

    function manageResourceRoots(){
        const state=getState();
        state.resource_roots=Array.isArray(state.resource_roots)?state.resource_roots:[];
        if(!state.resource_roots.length){addResourceRoot();return;}
        const options={}; state.resource_roots.forEach((root,index)=>options[String(index)]=`${index+1}. ${root}`);
        new Dialog({id:'gfbs_console_resource_roots',title:'Manage Resource Roots',width:720,form:{
            root:{label:'Resource Root',type:'select',options,value:'0'},
            operation:{label:'Operation',type:'select',options:{remove:'Remove',up:'Move Up',down:'Move Down',clear:'Clear All'},value:'remove'}
        },onConfirm(result){
            const index=Math.max(0,Math.min(state.resource_roots.length-1,Number(result.root)||0));
            if(result.operation==='clear')state.resource_roots=[];
            else if(result.operation==='remove')state.resource_roots.splice(index,1);
            else if(result.operation==='up'&&index>0)[state.resource_roots[index-1],state.resource_roots[index]]=[state.resource_roots[index],state.resource_roots[index-1]];
            else if(result.operation==='down'&&index<state.resource_roots.length-1)[state.resource_roots[index+1],state.resource_roots[index]]=[state.resource_roots[index],state.resource_roots[index+1]];
            saveGlobalSettings({resource_roots:state.resource_roots.slice()});
            clearPreviewCaches(); refreshAllDecorations();
            showInfo(`${state.resource_roots.length} resource root(s) active`);
        }}).show();
    }

    function showResourceSources(){
        const sources=resourceSources();
        const state=getState();
        const warnings=state&&state._resource_warnings?Object.entries(state._resource_warnings):[];
        Blockbench.showMessageBox({
            title:'GFBS Resource Sources',
            message:`${sources.length} active resource source(s); ${warnings.length} unresolved preview resource(s)`,
            detail:(sources.map((source,index)=>`${index+1}. ${source.kind.toUpperCase()} ${source.root}${source.auto?'  [auto]':''}`).join('\n') || 'No resource sources configured.')
                + (warnings.length?'\n\nUNRESOLVED / APPROXIMATE:\n'+warnings.map(([node,msg])=>`${node}: ${msg}`).join('\n'):'')
        });
    }

    function setWorkspaceRoot(){
        if(!Blockbench.pickDirectory)return showError('This Blockbench build does not expose directory selection');
        const chosen = Blockbench.pickDirectory({resource_id:'gfbs_console_workspace',title:'Select Minecraft / Forge Project Root'});
        if(!chosen)return;
        const state=getState();
        state.workspace_root=chosen;
        clearPreviewCaches();
        refreshAllDecorations();
        showInfo(`Workspace: ${chosen}`);
    }

    function createCodecAndFormat(){
        codec=new Codec(CODEC_ID,{
            name:'GFBS 3D-CONSOLE Scene', extension:'json', remember:true,
            load_filter:{
                type:'json', extensions:['json'],
                condition:model=>!!(model&&typeof model==='object'&&!Array.isArray(model)&&model.root&&typeof model.root==='object'&&(model.format_version===undefined||Number(model.format_version)===1))
            },
            compile(options={}){
                const validation=validateCurrentScene(false);
                if(validation.errors.length) throw new Error(`GFBS scene has ${validation.errors.length} validation error(s). Use Tools > GFBS 3D-CONSOLE > Validate Scene.`);
                const object=compileSceneDocument();
                this.dispatchEvent('compile',{model:object,options});
                return options.raw?object:pretty(object)+'\n';
            },
            parse(data,filePath){
                const object=typeof data==='string'?JSON.parse(data):data;
                loadSceneDocument(object,filePath);
                this.dispatchEvent('parse',{model:object});
            }
        });
        format=new ModelFormat(FORMAT_ID,{
            name:'GFBS 3D-CONSOLE Scene', description:'Visual authoring for GFBS-Main 3D-CONSOLE scene JSON', icon:'developer_board', category:'minecraft', target:'Minecraft: Java Edition',
            centered_grid:true, edit_mode:true, paint_mode:false, display_mode:false, animation_mode:false,
            meshes:false, locators:false, texture_meshes:false, rotate_cubes:false, rotation_limit:false,
            bone_rig:false, box_uv:false, single_texture:false, block_size:BB_UNITS_PER_BLOCK,
            euler_order:'XYZ', node_name_regex:'a-zA-Z0-9_.-',
            codec,
            onSetup(project,newModel){
                if(!projectStates.has(project.uuid))projectStates.set(project.uuid,defaultState());
                if(newModel)setTimeout(()=>{
                    if(Project===project&&isConsoleProject()&&ConsoleNodeElement.all.length===0){
                        new ConsoleNodeElement({name:'console_root',gfbs_type:'gfbs_main:node_3d',gfbs_spatial:true,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],gfbs_pivot:[0,0,0],gfbs_data_json:'{}',gfbs_properties_json:'{}'}).init().addTo('root');
                    }
                },0);
            }
        });
        codec.format=format;
    }

    function openSceneFile(){
        Blockbench.import({resource_id:'gfbs_console_scene_open',type:'GFBS 3D-CONSOLE Scene',extensions:['json'],readtype:'text',multiple:false},files=>{
            const file=files&&files[0]; if(!file)return;
            try{
                const object=JSON.parse(file.content);
                if(!object||typeof object!=='object'||Array.isArray(object)||!object.root){
                    throw new Error('This JSON does not look like a GFBS 3D-CONSOLE scene (missing root)');
                }
                codec.load(object,file);
            }catch(error){showError(error.message);}
        });
    }

    function saveSceneAs(){
        try{codec.export();}catch(error){showError(error.message);}
    }

    function registerAction(id,options,pathString){
        const action=new Action(id,options); actions.push(action); if(pathString)MenuBar.addAction(action,pathString); return action;
    }

    function registerActions(){
        registerAction('gfbs_console_open',{name:'Open GFBS 3D-CONSOLE Scene...',icon:'folder_open',condition:()=>true,click:openSceneFile},'file.import');
        registerAction('gfbs_console_save_as',{name:'Export GFBS Scene JSON...',icon:'save_as',condition:isConsoleProject,click:saveSceneAs},'file.export');

        registerAction('gfbs_console_add_node',{name:'Add GFBS Console Node...',icon:'add',condition:isConsoleProject,click:()=>addNode(null,null)},'edit');
        registerAction('gfbs_console_add_child',{name:'Add Child Console Node...',icon:'add_box',condition:isConsoleProject,click:()=>addNode(getCurrentConsoleParent(),null)});
        registerAction('gfbs_console_add_vanilla_model',{name:'Add Minecraft / Vanilla Model...',icon:'view_in_ar',condition:isConsoleProject,click:quickAddVanillaModel});
        registerAction('gfbs_console_add_gltf_model',{name:'Add GFBS glTF Model...',icon:'deployed_code',condition:isConsoleProject,click:quickAddGltfModel});
        registerAction('gfbs_console_add_text',{name:'Add Text...',icon:'text_fields',condition:isConsoleProject,click:quickAddText});
        registerAction('gfbs_console_add_button',{name:'Add Button...',icon:'radio_button_checked',condition:isConsoleProject,click:()=>quickAddControl('gfbs_main:button')});
        registerAction('gfbs_console_add_toggle',{name:'Add Toggle...',icon:'toggle_on',condition:isConsoleProject,click:()=>quickAddControl('gfbs_main:toggle')});
        registerAction('gfbs_console_add_knob',{name:'Add Knob...',icon:'tune',condition:isConsoleProject,click:()=>quickAddControl('gfbs_main:knob')});
        registerAction('gfbs_console_add_lever',{name:'Add Lever...',icon:'vertical_align_center',condition:isConsoleProject,click:()=>quickAddControl('gfbs_main:lever')});
        registerAction('gfbs_console_add_slider',{name:'Add Slider...',icon:'linear_scale',condition:isConsoleProject,click:()=>quickAddControl('gfbs_main:slider')});
        registerAction('gfbs_console_add_indicator',{name:'Add Indicator...',icon:'lightbulb',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:indicator',null)});
        registerAction('gfbs_console_add_animation',{name:'Add Animation Driver...',icon:'animation',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:animation',null)});
        registerAction('gfbs_console_add_sound',{name:'Add Sound Node...',icon:'volume_up',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:sound',null)});
        registerAction('gfbs_console_add_timer',{name:'Add Timer...',icon:'timer',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:timer',null)});
        registerAction('gfbs_console_add_linear_layout',{name:'Add Linear Layout...',icon:'view_week',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:linear_layout',null)});
        registerAction('gfbs_console_add_grid_layout',{name:'Add Grid Layout...',icon:'grid_view',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:grid_layout',null)});
        registerAction('gfbs_console_add_surface_layout',{name:'Add Surface Layout...',icon:'dashboard',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:surface_layout',null)});
        registerAction('gfbs_console_add_empty',{name:'Add Empty Node3D...',icon:'open_with',condition:isConsoleProject,click:()=>createConsoleNode('gfbs_main:node_3d',null)});
        registerAction('gfbs_console_starter_template',{name:'Create Starter Console Assembly',icon:'dashboard_customize',condition:isConsoleProject,click:createStarterConsoleTemplate});

        registerAction('gfbs_console_edit_node',{name:'Edit GFBS Console Node...',icon:'edit',condition:isConsoleProject,click:()=>openNodeEditor(selectedConsoleNode())});
        registerAction('gfbs_console_duplicate_subtree',{name:'Duplicate Subtree (Repair References)',icon:'content_copy',condition:isConsoleProject,click:duplicateSelectedSubtree});
        registerAction('gfbs_console_copy_node_json',{name:'Copy Selected Subtree JSON',icon:'data_object',condition:isConsoleProject,click:copySelectedNodeJson});
        registerAction('gfbs_console_find_node',{name:'Find / Select Node...',icon:'search',condition:isConsoleProject,click:showNodeFinder});
        registerAction('gfbs_console_overview',{name:'Scene Overview / Preflight',icon:'analytics',condition:isConsoleProject,click:showSceneOverview});
        registerAction('gfbs_console_simulate_activate',{name:'Simulate ACTIVATE',icon:'play_arrow',condition:isConsoleProject,click:simulateSelectedActivate});
        registerAction('gfbs_console_simulate_interaction',{name:'Simulate Interaction...',icon:'touch_app',condition:isConsoleProject,click:simulateSelectedInteraction});
        registerAction('gfbs_console_scene_properties',{name:'Scene Properties...',icon:'data_object',condition:isConsoleProject,click:()=>manageProperties(true)});
        registerAction('gfbs_console_node_properties',{name:'Selected Node Properties...',icon:'tune',condition:isConsoleProject,click:()=>manageProperties(false)});
        registerAction('gfbs_console_bindings',{name:'Bindings...',icon:'link',condition:isConsoleProject,click:manageBindings});
        registerAction('gfbs_console_connections',{name:'Connections / Actions...',icon:'account_tree',condition:isConsoleProject,click:manageConnections});
        registerAction('gfbs_console_model_parts',{name:'Model Part Aliases...',icon:'format_list_bulleted',condition:isConsoleProject,click:manageModelParts});
        registerAction('gfbs_console_material_profiles',{name:'Material Profiles...',icon:'palette',condition:isConsoleProject,click:manageMaterialProfiles});
        registerAction('gfbs_console_interaction_shape',{name:'Interaction Shape...',icon:'crop_free',condition:isConsoleProject,click:manageInteractionShape});
        registerAction('gfbs_console_fit_hitbox',{name:'Fit Interaction Hitbox',icon:'select_all',condition:isConsoleProject,click:fitHitbox});
        registerAction('gfbs_console_indicator_states',{name:'Indicator State Mappings...',icon:'lightbulb',condition:isConsoleProject,click:manageIndicatorStates});

        registerAction('gfbs_console_view_render',{name:'View Mode: Render',icon:'visibility',condition:isConsoleProject,click:()=>setPreviewMode(VIEW_MODE_RENDER)});
        registerAction('gfbs_console_view_authoring',{name:'View Mode: Authoring',icon:'construction',condition:isConsoleProject,click:()=>setPreviewMode(VIEW_MODE_AUTHORING)});
        registerAction('gfbs_console_view_debug',{name:'View Mode: Interaction Debug',icon:'bug_report',condition:isConsoleProject,click:()=>setPreviewMode(VIEW_MODE_DEBUG)});
        registerAction('gfbs_console_preview_state',{name:'Preview Runtime State...',icon:'tune',condition:isConsoleProject,click:managePreviewState});
        registerAction('gfbs_console_preview_snapshot',{name:'Show Resolved Preview State',icon:'data_object',condition:isConsoleProject,click:showPreviewRuntimeSnapshot});

        registerAction('gfbs_console_workspace',{name:'Set Minecraft Project Root...',icon:'folder',condition:isConsoleProject,click:setWorkspaceRoot});
        registerAction('gfbs_console_mc_assets_dir',{name:'Set Minecraft Assets Directory...',icon:'folder_special',condition:isConsoleProject,click:setMinecraftAssetsDirectory});
        registerAction('gfbs_console_mc_jar',{name:'Set Minecraft Client JAR...',icon:'inventory_2',condition:isConsoleProject,click:setMinecraftClientJar});
        registerAction('gfbs_console_mc_auto',{name:'Auto-detect Minecraft 1.20.1 Assets',icon:'travel_explore',condition:isConsoleProject,click:autoDetectMinecraftAssets});
        registerAction('gfbs_console_resource_root',{name:'Add Resource Pack / Resource Root...',icon:'create_new_folder',condition:isConsoleProject,click:addResourceRoot});
        registerAction('gfbs_console_manage_resource_roots',{name:'Manage Resource Roots...',icon:'folder_managed',condition:isConsoleProject,click:manageResourceRoots});
        registerAction('gfbs_console_resource_status',{name:'Show Active Resource Sources',icon:'source',condition:isConsoleProject,click:showResourceSources});
        registerAction('gfbs_console_reload_previews',{name:'Reload All Model / Texture Previews',icon:'refresh',condition:isConsoleProject,click:()=>{clearPreviewCaches();refreshAllDecorations();showInfo('GFBS visual previews reloaded');}});
        registerAction('gfbs_console_validate',{name:'Validate Scene',icon:'fact_check',condition:isConsoleProject,click:()=>validateCurrentScene(true)});

        const createMenu=new Menu('gfbs_console_create_menu',[
            'gfbs_console_starter_template','_',
            'gfbs_console_add_vanilla_model','gfbs_console_add_gltf_model','gfbs_console_add_text','_',
            'gfbs_console_add_button','gfbs_console_add_toggle','gfbs_console_add_knob','gfbs_console_add_lever','gfbs_console_add_slider','_',
            'gfbs_console_add_indicator','gfbs_console_add_animation','gfbs_console_add_sound','gfbs_console_add_timer','_',
            'gfbs_console_add_linear_layout','gfbs_console_add_grid_layout','gfbs_console_add_surface_layout','gfbs_console_add_empty','gfbs_console_add_node'
        ]);
        registerAction('gfbs_console_create_menu_action',{name:'Create / Add',icon:'add_box',condition:isConsoleProject,children:createMenu.structure});
        const structureMenu=new Menu('gfbs_console_structure_menu',[
            'gfbs_console_edit_node','gfbs_console_duplicate_subtree','gfbs_console_copy_node_json','gfbs_console_find_node'
        ]);
        registerAction('gfbs_console_structure_menu_action',{name:'Navigate / Structure',icon:'account_tree',condition:isConsoleProject,children:structureMenu.structure});
        const logicMenu=new Menu('gfbs_console_logic_menu',[
            'gfbs_console_scene_properties','gfbs_console_node_properties','gfbs_console_bindings','gfbs_console_connections'
        ]);
        registerAction('gfbs_console_logic_menu_action',{name:'Properties / Logic',icon:'schema',condition:isConsoleProject,children:logicMenu.structure});
        const previewMenu=new Menu('gfbs_console_preview_menu',[
            'gfbs_console_view_render','gfbs_console_view_authoring','gfbs_console_view_debug','_',
            'gfbs_console_preview_state','gfbs_console_preview_snapshot','_',
            'gfbs_console_simulate_activate','gfbs_console_simulate_interaction'
        ]);
        registerAction('gfbs_console_preview_menu_action',{name:'Preview / Simulate',icon:'play_circle',condition:isConsoleProject,children:previewMenu.structure});
        const nodeToolsMenu=new Menu('gfbs_console_node_tools_menu',[
            'gfbs_console_interaction_shape','gfbs_console_fit_hitbox','gfbs_console_indicator_states','gfbs_console_model_parts','gfbs_console_material_profiles'
        ]);
        registerAction('gfbs_console_node_tools_menu_action',{name:'Node Tools',icon:'construction',condition:isConsoleProject,children:nodeToolsMenu.structure});
        const resourcesMenu=new Menu('gfbs_console_resources_menu',[
            'gfbs_console_workspace','gfbs_console_mc_auto','gfbs_console_mc_assets_dir','gfbs_console_mc_jar','_',
            'gfbs_console_resource_root','gfbs_console_manage_resource_roots','gfbs_console_resource_status','gfbs_console_reload_previews'
        ]);
        registerAction('gfbs_console_resources_menu_action',{name:'Workspace / Resources',icon:'source',condition:isConsoleProject,children:resourcesMenu.structure});
        const menu=new Menu('gfbs_console_menu',[
            'gfbs_console_create_menu_action','gfbs_console_structure_menu_action','gfbs_console_logic_menu_action',
            'gfbs_console_preview_menu_action','gfbs_console_node_tools_menu_action','gfbs_console_resources_menu_action','_',
            'gfbs_console_overview','gfbs_console_validate'
        ]);
        registerAction('gfbs_console_menu_action',{name:'GFBS 3D-CONSOLE Studio',icon:'developer_board',condition:isConsoleProject,children:menu.structure},'tools');
    }

    function registerListeners(){
        listenerHandles.push(Blockbench.on('update_selection',()=>{
            if(isConsoleProject()) ConsoleNodeElement.all.forEach(el=>el.preview_controller.updateSelection(el));
        }));
        listenerHandles.push(Blockbench.on('close_project',event=>{
            if(event&&event.project)projectStates.delete(event.project.uuid);
            if(previewAnimationTimer){clearInterval(previewAnimationTimer);previewAnimationTimer=null;}
        }));
        listenerHandles.push(Blockbench.on('finished_edit',()=>{if(isConsoleProject())refreshAllTransforms();}));
    }

    function injectCss(){
        cssHandle=Blockbench.addCSS(`
            .gfbs-console-studio-hint { color: var(--color-accent); }
        `);
    }

    if (typeof process !== 'undefined' && process.env && process.env.GFBS_CONSOLE_STUDIO_TEST === '1') {
        globalThis.__GFBSConsoleStudioTestHooks = {
            getState,
            resolvePreviewValues,
            simulateInteraction,
            collectElements,
            javaLikeFormat,
            loadVanillaModelDefinition,
            modelResourceCandidates,
            readZipEntry,
            previewMappingKey,
            clearPreviewCaches,
            buildApproximateVanillaBlockPreview,
            approximateBlockColor,
            ensureLocalMinecraftAssetSource,
            faceTexture,
            configureMinecraftTexture,
            rewriteNodeDataReferences,
            rewriteBindingReferences,
            rewriteConnectionReferences,
            rewriteQualifiedReference,
            rewritePartReference,
            referenceUsesMappedNode,
            createSelectionProxyMaterial,
            updateSelectionProxy,
            applyTransformTree,
            getConsoleNodeType:() => ConsoleNodeElement
        };
    }

    Plugin.register(PLUGIN_ID,{
        title:'GFBS 3D-CONSOLE Studio',
        author:'LytharaLab',
        description:'Visual Blockbench editor for GFBS-Main 3D-CONSOLE scene JSON files',
        icon:'developer_board',
        tags:['Minecraft: Java Edition','Utility'],
        version:VERSION,
        min_version:'5.0.0',
        variant:'desktop',
        await_loading:true,
        onload(){
            try{
                registerConsoleNodeType();
                createCodecAndFormat();
                registerActions();
                registerListeners();
                injectCss();
                console.log(`[GFBS Console Studio] ${VERSION} loaded`);
            }catch(error){console.error('[GFBS Console Studio] failed to load',error);showError('Plugin failed to load',error.stack||error.message);}
        },
        onunload(){
            try{
                actions.reverse().forEach(action=>{try{action.delete();}catch(_){}});
                listenerHandles.splice(0).forEach(handle=>{try{if(handle&&handle.delete)handle.delete();}catch(_){}});
                if(cssHandle&&cssHandle.delete)cssHandle.delete();
                if(format)format.delete();
                if(codec)codec.delete();
                projectStates.clear();
                clearPreviewCaches();
                if(previewAnimationTimer){clearInterval(previewAnimationTimer);previewAnimationTimer=null;}
                if(previewRefreshTimer){clearTimeout(previewRefreshTimer);previewRefreshTimer=null;}
            }catch(error){console.warn('[GFBS Console Studio] unload warning',error);}
        }
    });
})();
