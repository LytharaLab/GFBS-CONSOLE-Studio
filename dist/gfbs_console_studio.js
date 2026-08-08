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
    const VERSION = '0.1.0';
    const BB_UNITS_PER_BLOCK = 16;
    const MAX_DEPTH = 64;
    const MAX_NODES = 4096;

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

    const nodeRequire = typeof require === 'function' ? require : null;
    const fs = nodeRequire ? safeRequire('fs') : null;
    const path = nodeRequire ? safeRequire('path') : null;

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
    }

    function isConsoleProject() {
        return typeof Format !== 'undefined' && Format && Format.id === FORMAT_ID;
    }

    function defaultState() {
        return {
            format_version: 1,
            properties: {},
            bindings: [],
            connections: [],
            extra_root_fields: {},
            workspace_root: null,
            source_path: null
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
        const root = resourcesRoot();
        if (!rl || !root || !path) return null;
        return path.join(root, 'assets', rl.namespace, ...rl.path.split('/'));
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

    function createWireMaterial(opacity = 0.9) {
        return new THREE.LineBasicMaterial({
            color: 0x72d7ff,
            transparent: opacity < 1,
            opacity,
            depthTest: true
        });
    }

    function createBoxLines(size, center) {
        const sx = Math.abs(size[0]) * BB_UNITS_PER_BLOCK;
        const sy = Math.abs(size[1]) * BB_UNITS_PER_BLOCK;
        const sz = Math.abs(size[2]) * BB_UNITS_PER_BLOCK;
        const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz));
        const lines = new THREE.LineSegments(geometry, createWireMaterial());
        lines.position.set(center[0] * BB_UNITS_PER_BLOCK, center[1] * BB_UNITS_PER_BLOCK, center[2] * BB_UNITS_PER_BLOCK);
        lines.userData.gfbsDecoration = true;
        return lines;
    }

    function createCross(size = 2.5) {
        const vertices = new Float32Array([
            -size,0,0, size,0,0,
            0,-size,0, 0,size,0,
            0,0,-size, 0,0,size
        ]);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        const line = new THREE.LineSegments(geometry, createWireMaterial());
        line.userData.gfbsDecoration = true;
        return line;
    }

    function makeTextPreview(text, pixelScale = 0.01) {
        const label = String(text || 'TEXT');
        const estimatedPixelWidth = Math.max(6, label.length * 6);
        const estimatedPixelHeight = 9;
        const width = Math.max(0.02, estimatedPixelWidth * Math.max(0.000001, finiteNumber(pixelScale, 0.01))) * BB_UNITS_PER_BLOCK;
        const height = Math.max(0.02, estimatedPixelHeight * Math.max(0.000001, finiteNumber(pixelScale, 0.01))) * BB_UNITS_PER_BLOCK;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(128, Math.min(1024, estimatedPixelWidth * 4));
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#11161c';
        ctx.globalAlpha = 0.72;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#72d7ff';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = '36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.length > 64 ? label.substring(0, 63) + '…' : label, canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({map: texture, transparent: true, side: THREE.DoubleSide});
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
        mesh.userData.gfbsDecoration = true;
        return mesh;
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
            object = createBoxLines(vector3(shape.size, [0.25, 0.25, 0.25]), center);
        } else if (type === 'sphere') {
            const radius = Math.max(0.001, finiteNumber(shape.radius, 0.125)) * BB_UNITS_PER_BLOCK;
            const geometry = new THREE.EdgesGeometry(new THREE.SphereGeometry(radius, 16, 10));
            object = new THREE.LineSegments(geometry, createWireMaterial());
            object.position.set(center[0] * BB_UNITS_PER_BLOCK, center[1] * BB_UNITS_PER_BLOCK, center[2] * BB_UNITS_PER_BLOCK);
        } else if (type === 'cylinder') {
            const radius = Math.max(0.001, finiteNumber(shape.radius, 0.125)) * BB_UNITS_PER_BLOCK;
            const height = Math.max(0.001, finiteNumber(shape.height, 0.25)) * BB_UNITS_PER_BLOCK;
            const geometry = new THREE.EdgesGeometry(new THREE.CylinderGeometry(radius, radius, height, 16));
            object = new THREE.LineSegments(geometry, createWireMaterial());
            object.position.set(center[0] * BB_UNITS_PER_BLOCK, center[1] * BB_UNITS_PER_BLOCK, center[2] * BB_UNITS_PER_BLOCK);
        } else if (type === 'plane' || type === 'plane_rect') {
            const width = Math.max(0.001, finiteNumber(shape.width, 0.25));
            const height = Math.max(0.001, finiteNumber(shape.height, 0.25));
            const thickness = Math.max(0.001, finiteNumber(shape.thickness, 0.01));
            object = createBoxLines([width, height, thickness], center);
        }
        if (object) {
            object.userData.gfbsHitShape = true;
            object.userData.gfbsDecoration = true;
        }
        return object;
    }

    function disposeObject(object) {
        object.traverse(child => {
            if (child.geometry && child.geometry.dispose) child.geometry.dispose();
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => {
                    if (material.map && material.map.dispose) material.map.dispose();
                    if (material.dispose) material.dispose();
                });
            }
        });
    }

    function clearPreviewDecorations(element) {
        if (!element.mesh) return;
        const remove = element.mesh.children.filter(child => child.userData && child.userData.gfbsDecoration);
        remove.forEach(child => {
            element.mesh.remove(child);
            disposeObject(child);
        });
        if (element._gfbsLinkedPreview) {
            element.mesh.remove(element._gfbsLinkedPreview);
            // Cached linked previews are cloned. Safe to dispose clone geometry only when not shared.
            element._gfbsLinkedPreview = null;
        }
    }

    function updateElementDecoration(element) {
        if (!element.mesh) return;
        clearPreviewDecorations(element);
        const type = element.gfbs_type;
        const data = nodeData(element);

        if (type === 'gfbs_main:model') {
            const source = data.source || {};
            const fallback = createBoxLines([1, 1, 1], [0.5, 0.5, 0.5]);
            fallback.material.opacity = 0.65;
            fallback.userData.gfbsModelFallback = true;
            element.mesh.add(fallback);
            if (source.adapter === 'gfbs_main:gltf') requestLinkedGltfPreview(element, source);
        } else if (type === 'gfbs_main:text') {
            element.mesh.add(makeTextPreview(data.text || 'TEXT', finiteNumber(data.pixel_scale, 0.01)));
        } else if (INTERACTION_TYPES.has(type)) {
            element.mesh.add(createCross(1.5));
            const hit = createHitShapePreview(element);
            if (hit) element.mesh.add(hit);
        } else if (type === 'gfbs_main:indicator') {
            const geometry = new THREE.SphereGeometry(1.5, 12, 8);
            const material = new THREE.MeshBasicMaterial({color: 0x72d7ff, wireframe: true});
            const mesh = new THREE.Mesh(geometry, material);
            mesh.userData.gfbsDecoration = true;
            element.mesh.add(mesh);
        } else if (type === 'gfbs_main:sound') {
            const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(2.0, 12, 6)), createWireMaterial(0.65));
            ring.userData.gfbsDecoration = true;
            element.mesh.add(ring);
        } else {
            element.mesh.add(createCross(type === 'gfbs_main:node' ? 1.2 : 2.0));
        }
    }

    function applyTransform(element) {
        const mesh = element.mesh;
        if (!mesh) return;

        // GFBS transforms are local to the parent console node. Blockbench only
        // auto-parents element meshes for bone-rig formats, so this custom format
        // must explicitly mirror the Outliner hierarchy in the THREE scene graph.
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
        const pivotVector = new THREE.Vector3(
            pivot[0] * BB_UNITS_PER_BLOCK,
            pivot[1] * BB_UNITS_PER_BLOCK,
            pivot[2] * BB_UNITS_PER_BLOCK
        );
        const transformedPivot = pivotVector.clone().multiply(new THREE.Vector3(scale[0], scale[1], scale[2])).applyQuaternion(quaternion);
        logicalPosition.add(pivotVector).sub(transformedPivot);

        mesh.position.copy(logicalPosition);
        mesh.quaternion.copy(quaternion);
        mesh.scale.set(scale[0], scale[1], scale[2]);
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
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
        if (parent.gfbs_type === 'gfbs_main:linear_layout') {
            return [spacing[0] * index, spacing[1] * index, spacing[2] * index];
        }
        const row = Math.floor(index / columns);
        return [
            (index % columns) * spacing[0],
            row * spacing[1],
            parent.gfbs_type === 'gfbs_main:surface_layout' ? 0 : row * spacing[2]
        ];
    }

    function refreshAllTransforms() {
        if (!ConsoleNodeElement) return;
        ConsoleNodeElement.all.forEach(element => applyTransform(element));
        if (typeof Canvas !== 'undefined' && Canvas.updateView) {
            Canvas.updateView({elements: ConsoleNodeElement.all, element_aspects: {transform: true, geometry: true}, selection: true});
        }
    }

    function refreshAllDecorations() {
        if (!ConsoleNodeElement) return;
        ConsoleNodeElement.all.forEach(updateElementDecoration);
        refreshAllTransforms();
    }

    // -----------------------------
    // Minimal linked glTF 2.0 preview
    // -----------------------------

    function requestLinkedGltfPreview(element, source) {
        if (!source || source.adapter !== 'gfbs_main:gltf' || !fs || !path || !element || !element.mesh) return;
        const filePath = resolveAssetLocation(source.location);
        if (!filePath || !fs.existsSync(filePath)) return;
        const token = (element._gfbsPreviewToken || 0) + 1;
        element._gfbsPreviewToken = token;

        // Blockbench 5.x exposes THREE.GLTFLoader globally (the official Reference Models plugin uses it).
        if (THREE && typeof THREE.GLTFLoader === 'function') {
            let promise = linkedPreviewCache.get(filePath);
            if (!promise || typeof promise.then !== 'function') {
                promise = new Promise((resolve, reject) => {
                    const loader = new THREE.GLTFLoader();
                    if (loader.setPath) loader.setPath(path.dirname(filePath) + path.sep);
                    loader.load(path.basename(filePath), gltf => resolve(gltf.scene), undefined, reject);
                });
                linkedPreviewCache.set(filePath, promise);
            }
            promise.then(template => {
                if (!element.mesh || element._gfbsPreviewToken !== token) return;
                const linked = cloneThreeObject(template);
                linked.scale.multiplyScalar(BB_UNITS_PER_BLOCK);
                linked.userData.gfbsDecoration = true;
                linked.userData.gfbsLinkedModel = true;
                const stale = element.mesh.children.filter(child => child.userData && (child.userData.gfbsModelFallback || child.userData.gfbsLinkedModel));
                stale.forEach(child => { element.mesh.remove(child); disposeObject(child); });
                element.mesh.add(linked);
                element._gfbsLinkedPreview = linked;
                applyTransform(element);
            }).catch(error => console.warn('[GFBS Console Studio] Blockbench GLTFLoader preview failed', filePath, error));
            return;
        }

        // Fallback for unusual builds where GLTFLoader is unavailable. This reader covers static core glTF 2.0 geometry.
        const linked = tryCreateLinkedModelPreview(element, source);
        if (linked && element.mesh && element._gfbsPreviewToken === token) {
            linked.userData.gfbsDecoration = true;
            linked.userData.gfbsLinkedModel = true;
            const stale = element.mesh.children.filter(child => child.userData && child.userData.gfbsModelFallback);
            stale.forEach(child => { element.mesh.remove(child); disposeObject(child); });
            element.mesh.add(linked);
            element._gfbsLinkedPreview = linked;
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

    function cloneThreeObject(object) {
        const cloned = object.clone(true);
        cloned.traverse(child => {
            if (child.geometry && child.geometry.clone) child.geometry = child.geometry.clone();
            if (child.material && child.material.clone) child.material = child.material.clone();
        });
        return cloned;
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
        const material = new MaterialClass(options);
        return material;
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
                const mesh = new THREE.Group();
                Project.nodes_3d[element.uuid] = mesh;
                mesh.name = element.uuid;
                mesh.type = element.type;
                mesh.isElement = true;
                mesh.visible = element.visibility !== false;
                updateElementDecoration(element);
                applyTransform(element);
                this.dispatchEvent('setup', {element});
            },
            updateTransform(element) {
                applyTransform(element);
                this.dispatchEvent('update_transform', {element});
            },
            updateGeometry(element) {
                updateElementDecoration(element);
                applyTransform(element);
                this.dispatchEvent('update_geometry', {element});
            },
            updateVisibility(element) {
                if (element.mesh) element.mesh.visible = element.visibility !== false;
            },
            updateSelection(element) {
                if (!element.mesh) return;
                element.mesh.traverse(child => {
                    if (child.material && child.userData && child.userData.gfbsDecoration) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(mat => {
                            if (mat.color && child.userData.gfbsHitShape) mat.color.set(element.selected ? 0xffd15c : 0x72d7ff);
                        });
                    }
                });
                this.dispatchEvent('update_selection', {element});
            },
            remove(element) {
                if (element.mesh) {
                    clearPreviewDecorations(element);
                    if (element.mesh.parent) element.mesh.parent.remove(element.mesh);
                }
                delete Project.nodes_3d[element.uuid];
            }
        });

        ConsoleNodeElement.prototype.menu = new Menu([
            'gfbs_console_edit_node',
            'gfbs_console_add_child',
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
        state.workspace_root = resolveWorkspaceRoot(filePath);

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

                    Undo.initEdit({elements: [element], outliner: true, selection: true});
                    element.name = result.id;
                    element.gfbs_type = newType;
                    element.gfbs_spatial = SPATIAL_TYPES.has(newType) || !!result.spatial;
                    element.position = vector3(result.position, [0,0,0]).map(v => v * BB_UNITS_PER_BLOCK);
                    element.rotation = vector3(result.rotation, [0,0,0]);
                    element.scale = newScale;
                    element.gfbs_pivot = vector3(result.pivot, [0,0,0]);
                    element.gfbs_data_json = pretty(newData);
                    element.gfbs_properties_json = pretty(newProperties);
                    element.updateElement();
                    updateElementDecoration(element);
                    refreshAllTransforms();
                    Undo.finishEdit('Edit GFBS console node');
                } catch (error) { showError(error.message); }
            }
        }).show();
    }

    function addNode(parent, forcedType) {
        const create = type => {
            const baseName = type.split(':').pop().replace(/[^a-zA-Z0-9_]/g, '_');
            let name = baseName;
            let i = 2;
            while (ConsoleNodeElement.all.some(e => e.name === name)) name = `${baseName}_${i++}`;
            const data = defaultDataForType(type);
            Undo.initEdit({outliner: true, elements: [], selection: true});
            const element = new ConsoleNodeElement({
                name,
                gfbs_type: type,
                gfbs_spatial: SPATIAL_TYPES.has(type),
                position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], gfbs_pivot:[0,0,0],
                gfbs_data_json: pretty(data),
                gfbs_properties_json: pretty(defaultPropertiesForType(type))
            }).init().addTo(parent || getCurrentConsoleParent());
            element.select();
            refreshAllTransforms();
            Undo.finishEdit('Add GFBS console node');
            openNodeEditor(element);
        };
        if (forcedType) return create(forcedType);
        new Dialog({
            id: 'gfbs_console_add_node_dialog',
            title: 'Add GFBS Console Node',
            form: {type: {label: 'Node Type', type: 'select', options: typeOptions(), value: 'gfbs_main:node_3d'}},
            onConfirm(result) { create(result.type); }
        }).show();
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
        if (INTERACTION_TYPES.has(type)) return {interaction:{max_distance:5, shape:{type:'box', center:[0,0,0], size:[0.25,0.2,0.12]}, min:0, max:1, step:0}};
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
        (element.children||[]).forEach(child=>{
            if(child instanceof ConsoleNodeElement&&child.mesh){const childBox=new THREE.Box3().setFromObject(child.mesh); if(!childBox.isEmpty()){box.union(childBox);found=true;}}
        });
        if(!found&&element.mesh){box=new THREE.Box3().setFromObject(element.mesh);found=!box.isEmpty();}
        if(!found)return showError('No visible geometry found to fit hitbox');
        const inv=new THREE.Matrix4().copy(element.mesh.matrixWorld).invert();
        const corners=[]; for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z).applyMatrix4(inv));
        const local=new THREE.Box3().setFromPoints(corners); const size=new THREE.Vector3(),center=new THREE.Vector3(); local.getSize(size);local.getCenter(center);
        const data=nodeData(element); const interaction=data.interaction&&typeof data.interaction==='object'?data.interaction:{};
        interaction.shape={type:'box',center:[center.x/BB_UNITS_PER_BLOCK,center.y/BB_UNITS_PER_BLOCK,center.z/BB_UNITS_PER_BLOCK],size:[Math.max(size.x/BB_UNITS_PER_BLOCK,0.001),Math.max(size.y/BB_UNITS_PER_BLOCK,0.001),Math.max(size.z/BB_UNITS_PER_BLOCK,0.001)]};
        if(interaction.max_distance===undefined)interaction.max_distance=5; data.interaction=interaction; element.gfbs_data_json=pretty(data); updateElementDecoration(element); markDirty(); showInfo('Interaction hitbox fitted to visible geometry');
    }

    function setWorkspaceRoot(){
        if(!Blockbench.pickDirectory)return showError('This Blockbench build does not expose directory selection');
        const chosen = Blockbench.pickDirectory({
            resource_id:'gfbs_console_workspace',
            title:'Select Minecraft / Forge Project Root'
        });
        if(!chosen)return;
        const state=getState();
        state.workspace_root=chosen;
        linkedPreviewCache.clear();
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
        registerAction('gfbs_console_add_child',{name:'Add Child Console Node...',icon:'add_box',condition:isConsoleProject,click:()=>addNode(selectedConsoleNode()||'root',null)});
        registerAction('gfbs_console_edit_node',{name:'Edit GFBS Console Node...',icon:'edit',condition:isConsoleProject,click:()=>openNodeEditor(selectedConsoleNode())});
        registerAction('gfbs_console_scene_properties',{name:'Scene Properties...',icon:'data_object',condition:isConsoleProject,click:()=>manageProperties(true)});
        registerAction('gfbs_console_node_properties',{name:'Selected Node Properties...',icon:'tune',condition:isConsoleProject,click:()=>manageProperties(false)});
        registerAction('gfbs_console_bindings',{name:'Bindings...',icon:'link',condition:isConsoleProject,click:manageBindings});
        registerAction('gfbs_console_connections',{name:'Connections / Actions...',icon:'account_tree',condition:isConsoleProject,click:manageConnections});
        registerAction('gfbs_console_model_parts',{name:'Model Part Aliases...',icon:'format_list_bulleted',condition:isConsoleProject,click:manageModelParts});
        registerAction('gfbs_console_material_profiles',{name:'Material Profiles...',icon:'palette',condition:isConsoleProject,click:manageMaterialProfiles});
        registerAction('gfbs_console_interaction_shape',{name:'Interaction Shape...',icon:'crop_free',condition:isConsoleProject,click:manageInteractionShape});
        registerAction('gfbs_console_fit_hitbox',{name:'Fit Interaction Hitbox',icon:'select_all',condition:isConsoleProject,click:fitHitbox});
        registerAction('gfbs_console_indicator_states',{name:'Indicator State Mappings...',icon:'lightbulb',condition:isConsoleProject,click:manageIndicatorStates});
        registerAction('gfbs_console_workspace',{name:'Set Minecraft Project Root...',icon:'folder',condition:isConsoleProject,click:setWorkspaceRoot});
        registerAction('gfbs_console_reload_previews',{name:'Reload Linked Model Previews',icon:'refresh',condition:isConsoleProject,click:()=>{linkedPreviewCache.clear();refreshAllDecorations();showInfo('Linked previews reloaded');}});
        registerAction('gfbs_console_validate',{name:'Validate Scene',icon:'fact_check',condition:isConsoleProject,click:()=>validateCurrentScene(true)});

        const menu=new Menu('gfbs_console_menu',[
            'gfbs_console_add_node','gfbs_console_edit_node','_',
            'gfbs_console_scene_properties','gfbs_console_node_properties','gfbs_console_bindings','gfbs_console_connections','_',
            'gfbs_console_interaction_shape','gfbs_console_fit_hitbox','gfbs_console_indicator_states','gfbs_console_model_parts','gfbs_console_material_profiles','_',
            'gfbs_console_workspace','gfbs_console_reload_previews','gfbs_console_validate'
        ]);
        registerAction('gfbs_console_menu_action',{name:'GFBS 3D-CONSOLE',icon:'developer_board',condition:isConsoleProject,children:menu.structure},'tools');
    }

    function registerListeners(){
        listenerHandles.push(Blockbench.on('update_selection',()=>{
            if(isConsoleProject()) ConsoleNodeElement.all.forEach(el=>el.preview_controller.updateSelection(el));
        }));
        listenerHandles.push(Blockbench.on('close_project',event=>{
            if(event&&event.project)projectStates.delete(event.project.uuid);
        }));
        listenerHandles.push(Blockbench.on('finished_edit',()=>{if(isConsoleProject())refreshAllTransforms();}));
    }

    function injectCss(){
        cssHandle=Blockbench.addCSS(`
            .gfbs-console-studio-hint { color: var(--color-accent); }
        `);
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
                linkedPreviewCache.clear();
            }catch(error){console.warn('[GFBS Console Studio] unload warning',error);}
        }
    });
})();
