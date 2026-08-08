const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
process.env.GFBS_CONSOLE_STUDIO_TEST = '1';


function makeStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30 + nameBuf.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14); // CRC intentionally omitted: reader does not validate it
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    data.copy(local, 30 + nameBuf.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralOffset = offset;
  const centralData = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries && Object.keys(entries).length, 8);
  eocd.writeUInt16LE(entries && Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, centralData, eocd]);
}

const originalSetTimeout = global.setTimeout;
global.setTimeout = () => 0; // keep preview refresh out of this headless schema smoke test

let registeredPlugin;
let createdCodec;
let createdFormat;
let uuidCounter = 1;

class MockOutlinerElement {
  constructor(data = {}, uuid) {
    this.uuid = uuid || `uuid-${uuidCounter++}`;
    this.parent = 'root';
    this.children = [];
    this.selected = false;
  }
  init() {
    const cls = this.constructor;
    if (!cls.all.includes(this)) cls.all.push(this);
    return this;
  }
  addTo(parent) {
    this.removeFromParent();
    this.parent = parent || 'root';
    if (this.parent === 'root') Outliner.root.push(this);
    else this.parent.children.push(this);
    return this;
  }
  removeFromParent() {
    if (this.parent === 'root') {
      const i = Outliner.root.indexOf(this); if (i >= 0) Outliner.root.splice(i, 1);
    } else if (this.parent && Array.isArray(this.parent.children)) {
      const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1);
    }
  }
  remove() {
    [...this.children].forEach(child => child.remove());
    this.removeFromParent();
    const cls = this.constructor;
    const i = cls.all.indexOf(this); if (i >= 0) cls.all.splice(i, 1);
  }
  sanitizeName() { return this; }
}
MockOutlinerElement.registerType = function(cls) {
  cls.all = [];
  cls.selected = [];
  cls.properties = cls.properties || {};
};
global.OutlinerElement = MockOutlinerElement;

global.Property = class Property {
  constructor(cls, type, name, options = {}) {
    cls.properties = cls.properties || {};
    const defaultValue = options.default;
    cls.properties[name] = {
      reset(obj) {
        const value = typeof defaultValue === 'function' ? defaultValue(obj) : defaultValue;
        obj[name] = Array.isArray(value) ? value.slice() : (value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);
      },
      merge(obj, src) {
        if (src && Object.prototype.hasOwnProperty.call(src, name)) {
          const value = src[name];
          obj[name] = Array.isArray(value) ? value.slice() : (value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);
        }
      },
      copy(obj, out) {
        const value = obj[name];
        out[name] = Array.isArray(value) ? value.slice() : (value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);
      }
    };
  }
};

global.NodePreviewController = class NodePreviewController {
  constructor(cls, methods) {
    const controller = Object.assign({
      updateSelection() {}, updateGeometry() {}, updateTransform() {}, updateVisibility() {},
      dispatchEvent() {}
    }, methods);
    cls.prototype.preview_controller = controller;
  }
};
global.NodePreviewController.prototype = {updateTransform() {}};

global.Menu = class Menu {
  constructor(idOrTemplate, template) {
    this.structure = Array.isArray(idOrTemplate) ? idOrTemplate : template || [];
  }
};

global.Action = class Action {
  constructor(id, options) { this.id = id; Object.assign(this, options); }
  delete() {}
};

global.Codec = class Codec {
  constructor(id, options) { this.id = id; Object.assign(this, options); createdCodec = this; }
  load(model, file) {
    global.Format = this.format;
    Project.export_path = file && file.path;
    Project.export_codec = this.id;
    this.parse(model, file && file.path);
  }
  dispatchEvent() {}
  export() {}
  delete() {}
};

global.ModelFormat = class ModelFormat {
  constructor(id, options) { this.id = id; Object.assign(this, options); createdFormat = this; }
  new() { global.Format = this; return true; }
  delete() {}
};

global.Dialog = class Dialog { constructor() {} show() {} };

global.Outliner = {
  root: [],
  selected: [],
  buttons: {locked: {}, visibility: {}},
  control_menu_group: []
};

global.MenuBar = {addAction() {}};
global.Project = {uuid: 'test-project', name: 'test', nodes_3d: {}, save_path: null, export_path: null};
global.Format = null;
global.Blockbench = {
  on() { return {delete() {}}; },
  addCSS() { return {delete() {}}; },
  showMessageBox() {},
  showQuickMessage() {},
  import() {},
  pickDirectory() {}
};
global.Plugin = {
  register(id, options) {
    registeredPlugin = {id, options};
    options.onload();
  }
};
// References only used by preview paths that this smoke test intentionally does not execute.
global.THREE = {};

require(path.resolve(__dirname, '../dist/gfbs_console_studio.js'));
assert(registeredPlugin, 'plugin registered');
assert(createdCodec, 'codec created');
assert(createdFormat, 'format created');
assert.strictEqual(createdFormat.euler_order, 'XYZ', 'editor uses GFBS XYZ Euler order');
assert(createdCodec.load_filter && createdCodec.load_filter.condition({format_version: 1, root: {id: 'root'}}), 'GFBS JSON is recognized by codec filter');
assert(!createdCodec.load_filter.condition({parent: 'minecraft:block/cube_all'}), 'ordinary Minecraft model JSON is not claimed');
global.Format = createdFormat;

const fixture = {
  format_version: 1,
  properties: {
    power: {type: 'boolean', default: false, sync: true, save: true},
    mode: {type: 'string', default: 'STANDBY', sync: true, save: true},
    output: {type: 'double', default: 50, sync: true, save: true, interpolate: true},
    target: {type: 'vec3', default: [1, 2, 3], sync: true, save: false},
    icon: {type: 'resource', default: 'minecraft:stone', sync: true, save: false}
  },
  root: {
    id: 'console_root', type: 'gfbs_main:node_3d',
    children: [
      {
        id: 'model', type: 'gfbs_main:model',
        transform: {position: [1, 2, 3], rotation: [10, 20, 30], scale: [2, 1, 0.5], pivot: [0.25, 0, 0]},
        source: {adapter: 'gfbs_main:gltf', location: 'gfbs_main:models/console/test.gltf'},
        parts: {lamp: 'Lamp'},
        material_profiles: {off: {shading: 'pbr', color: [0.1, 0.1, 0.1, 1], fullbright: false}}
      },
      {id: 'text', type: 'gfbs_main:text', text: 'HELLO', pixel_scale: 0.0045,
       properties: {color: {type: 'color', default: '#FFFFFFFF', sync: true}}},
      {id: 'indicator', type: 'gfbs_main:indicator', source: '$root.power', target: 'model::lamp', states: {false: 'off', true: 'off'}},
      {id: 'anim', type: 'gfbs_main:animation', target_model: 'model', animation: 'pulse'},
      {id: 'sound', type: 'gfbs_main:sound', sound: 'gfbs_main:test', looping: true, min_distance: 1, max_distance: 32},
      {id: 'timer', type: 'gfbs_main:timer', interval: 2},
      {id: 'third_party_spatial', type: 'example_mod:custom_panel', transform: {position: [0.25, 0.5, -0.75], rotation: [0, 45, 0], scale: [1.2, 1, 1]}},
      {
        id: 'grid', type: 'gfbs_main:grid_layout', transform: {position: [0, 1, 0]}, spacing: [0.4, -0.3, 0], columns: 2,
        children: [
          {id: 'power_toggle', type: 'gfbs_main:toggle', interaction: {max_distance: 6, min: 0, max: 1, step: 0.1, shape: {type: 'box', center: [0,0,0], size: [0.3,0.2,0.1]}}},
          {id: 'scram', type: 'gfbs_main:button', interaction: {shape: {type: 'sphere', center: [0,0,0], radius: 0.1}}},
          {id: 'knob', type: 'gfbs_main:knob', interaction: {shape: {type: 'cylinder', center: [0,0,0], radius: 0.1, height: 0.2}}},
          {id: 'slider', type: 'gfbs_main:slider', interaction: {shape: {type: 'plane_rect', center: [0,0,0], width: 0.2, height: 0.4, thickness: 0.02}}}
        ]
      }
    ]
  },
  bindings: [
    {source: 'power_toggle.state', target: '$root.power'},
    {source: 'knob.value', target: '$root.output', range: {input_min: 0, input_max: 1, output_min: 0, output_max: 100}},
    {source: '$root.mode', target: 'text.text', format: 'MODE // %s'}
  ],
  connections: [
    {from: 'power_toggle.toggled', action: {type: 'host', id: 'gfbs_main:set_power'}},
    {from: 'scram.activated', action: {type: 'set', target: '$root.mode', value: 'EMERGENCY'}}
  ]
};

const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'gfbs-console-studio-'));
const resources = path.join(tempProject, 'src', 'main', 'resources');
const sceneDir = path.join(resources, 'data', 'gfbs_main', 'gfbs_console', 'scenes');
const modelDir = path.join(resources, 'assets', 'minecraft', 'models', 'block');
const textureDir = path.join(resources, 'assets', 'minecraft', 'textures', 'block');
fs.mkdirSync(sceneDir, {recursive: true});
fs.mkdirSync(modelDir, {recursive: true});
fs.mkdirSync(textureDir, {recursive: true});
fs.writeFileSync(path.join(modelDir, 'cube_all.json'), JSON.stringify({
  textures: {all: '#all'},
  elements: [{from:[0,0,0],to:[16,16,16],faces:{down:{texture:'#all'},up:{texture:'#all'},north:{texture:'#all'},south:{texture:'#all'},west:{texture:'#all'},east:{texture:'#all'}}}]
}));
fs.writeFileSync(path.join(modelDir, 'stone.json'), JSON.stringify({parent:'minecraft:block/cube_all', textures:{all:'minecraft:block/stone'}}));
// TextureLoader is mocked below; it only needs bytes to prove Studio resolves a PNG data URL.
fs.writeFileSync(path.join(textureDir, 'stone.png'), Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]));
const fixturePath = path.join(sceneDir, 'test.json');
createdCodec.load(JSON.parse(JSON.stringify(fixture)), {path: fixturePath, name: 'test.json'});
assert.strictEqual(Project.export_path, fixturePath, 'scene path is the format export path');
assert.strictEqual(Project.export_codec, 'gfbs_console_scene', 'scene codec is remembered for Ctrl+S');
assert.strictEqual(Project.save_path, '', 'GFBS scene is not treated as a .bbmodel save path');
const compiled = createdCodec.compile({raw: true});

assert.strictEqual(compiled.format_version, 1);
assert.strictEqual(compiled.root.id, 'console_root');
assert.strictEqual(compiled.root.children.length, fixture.root.children.length);
assert.deepStrictEqual(compiled.properties, fixture.properties);
assert.deepStrictEqual(compiled.bindings, fixture.bindings);
assert.deepStrictEqual(compiled.connections, fixture.connections);

const hooks = global.__GFBSConsoleStudioTestHooks;
assert(hooks, 'test hooks exposed');
const refMap = new Map([['model', 'model_renamed'], ['node.with.dots', 'dotted_copy']]);
assert.strictEqual(hooks.rewriteQualifiedReference('node.with.dots.value', refMap), 'dotted_copy.value', 'qualified references support dotted node IDs');
assert.strictEqual(hooks.rewritePartReference('model::lamp', refMap), 'model_renamed::lamp', 'model part references are repaired');
assert.deepStrictEqual(
  hooks.rewriteNodeDataReferences({source:'node.with.dots.value',target:'model::lamp',target_model:'model'}, refMap),
  {source:'dotted_copy.value',target:'model_renamed::lamp',target_model:'model_renamed'},
  'known node-data references are repaired together'
);
assert.deepStrictEqual(
  hooks.rewriteBindingReferences({source:'model.alpha',target:'$root.output'}, refMap),
  {source:'model_renamed.alpha',target:'$root.output'},
  'binding references are repaired without changing root addresses'
);
assert.deepStrictEqual(
  hooks.rewriteConnectionReferences({from:'model.clicked',action:{type:'emit',target:'node.with.dots.changed'}}, refMap),
  {from:'model_renamed.clicked',action:{type:'emit',target:'dotted_copy.changed'}},
  'connection source and action target references are repaired'
);

// Blockbench 5.1.x currently embeds three.js r129. Verify the invisible root
// proxy is genuinely raycastable and only fits direct visuals, not child nodes.
const ThreeRuntime = require('three');
global.THREE = ThreeRuntime;
const proxyMesh = new ThreeRuntime.Mesh(
  new ThreeRuntime.BoxGeometry(5, 5, 5),
  hooks.createSelectionProxyMaterial()
);
proxyMesh.userData.gfbsSelectionProxy = true;
proxyMesh.name = 'selection-proxy-test';
proxyMesh.isElement = true;
const ownVisual = new ThreeRuntime.Mesh(new ThreeRuntime.BoxGeometry(32, 8, 4), new ThreeRuntime.MeshBasicMaterial());
proxyMesh.add(ownVisual);
const foreignChildElement = new ThreeRuntime.Mesh(new ThreeRuntime.BoxGeometry(256, 256, 256), new ThreeRuntime.MeshBasicMaterial());
foreignChildElement.isElement = true;
foreignChildElement.name = 'another-console-node';
proxyMesh.add(foreignChildElement);
const selectableElement = {uuid:'selection-proxy-test',mesh:proxyMesh,gfbs_type:'gfbs_main:model',selected:false};
hooks.updateSelectionProxy(selectableElement);
proxyMesh.geometry.computeBoundingBox();
const proxySize = new ThreeRuntime.Vector3();
proxyMesh.geometry.boundingBox.getSize(proxySize);
assert(proxySize.x > 32 && proxySize.x < 64, 'selection proxy fits direct model geometry with padding');
assert(proxySize.y < 32, 'selection proxy excludes a huge child Console element');
proxyMesh.updateMatrixWorld(true);
const raycaster = new ThreeRuntime.Raycaster(new ThreeRuntime.Vector3(0,0,100), new ThreeRuntime.Vector3(0,0,-1));
assert(raycaster.intersectObject(proxyMesh, false).length > 0, 'fully transparent selection proxy remains raycastable');
selectableElement.selected = true;
hooks.updateSelectionProxy(selectableElement);
assert(proxyMesh.children.some(child => child.userData && child.userData.gfbsSelectionOutline && child.visible), 'selected node gets a visible selection outline');

const ConsoleNodeType = hooks.getConsoleNodeType();
const parentNode = Object.assign(Object.create(ConsoleNodeType.prototype), {
  uuid:'parent-transform-test',name:'parent',gfbs_type:'gfbs_main:node_3d',gfbs_spatial:true,
  position:[16,0,0],rotation:[0,0,0],scale:[1,1,1],gfbs_pivot:[0,0,0],children:[],parent:'root'
});
const childNode = Object.assign(Object.create(ConsoleNodeType.prototype), {
  uuid:'child-transform-test',name:'child',gfbs_type:'gfbs_main:node_3d',gfbs_spatial:true,
  position:[0,16,0],rotation:[0,0,0],scale:[1,1,1],gfbs_pivot:[0,0,0],children:[],parent:parentNode
});
parentNode.children.push(childNode);
const parentMesh = new ThreeRuntime.Group();
const childMesh = new ThreeRuntime.Group();
Object.defineProperty(parentNode,'mesh',{value:parentMesh,configurable:true});
Object.defineProperty(childNode,'mesh',{value:childMesh,configurable:true});
Project.model_3d = new ThreeRuntime.Group();
hooks.applyTransformTree(parentNode);
assert.strictEqual(parentMesh.parent, Project.model_3d, 'root Console node is attached to the project scene');
assert.strictEqual(childMesh.parent, parentMesh, 'child Console node is attached to its parent preview object');
let childWorld = new ThreeRuntime.Vector3();
childMesh.getWorldPosition(childWorld);
assert.deepStrictEqual(childWorld.toArray().map(Math.round), [16,16,0], 'child world transform initially includes parent position');
parentNode.position = [32,0,0];
hooks.applyTransformTree(parentNode);
childMesh.getWorldPosition(childWorld);
assert.deepStrictEqual(childWorld.toArray().map(Math.round), [32,16,0], 'moving a parent updates the child world transform');
global.THREE = {};

assert.strictEqual(hooks.javaLikeFormat('OUTPUT %03.0f %%', 7), 'OUTPUT 007 %', 'Java-like format preview matches scene binding use');
let preview = hooks.resolvePreviewValues();
assert.strictEqual(preview['$root.power'], false, 'preview defaults start from scene state');
assert.strictEqual(preview['text.text'], 'MODE // STANDBY', 'preview binding format is evaluated');
hooks.getState().preview_values['power_toggle.state'] = true;
hooks.getState()._resolved_preview_values = null;
preview = hooks.resolvePreviewValues();
assert.strictEqual(preview['$root.power'], true, 'preview override propagates through bindings');
const powerToggleElement = hooks.collectElements().find(element => element.name === 'power_toggle');
hooks.getState().preview_values = {};
hooks.getState()._resolved_preview_values = null;
const simulationLog = hooks.simulateInteraction(powerToggleElement, 'ACTIVATE', true);
preview = hooks.resolvePreviewValues();
assert.strictEqual(preview['power_toggle.state'], true, 'interaction simulation toggles control state like runtime');
assert.strictEqual(preview['$root.power'], true, 'interaction simulation propagates binding to root property');
assert(simulationLog.some(line => line.startsWith('HOST gfbs_main:set_power')), 'host action is surfaced but not executed in Blockbench preview');
hooks.getState().preview_mode = 'debug';
hooks.getState().minecraft_asset_source = '/editor-only/minecraft.jar';
const compileAfterPreview = createdCodec.compile({raw: true});
assert.strictEqual(compileAfterPreview.root.children.find(n => n.id === 'power_toggle'), undefined, 'nested control remains nested rather than leaked to scene root');
assert(!Object.prototype.hasOwnProperty.call(compileAfterPreview, 'preview_mode'), 'view mode is editor-only and never serialized');
assert(!Object.prototype.hasOwnProperty.call(compileAfterPreview, 'preview_values'), 'preview overrides are editor-only and never serialized');
assert(!Object.prototype.hasOwnProperty.call(compileAfterPreview, 'minecraft_asset_source'), 'resource source configuration is editor-only and never serialized');
const vanilla = hooks.loadVanillaModelDefinition('minecraft:stone');
assert(Array.isArray(vanilla.elements) && vanilla.elements.length === 1, 'vanilla model parent geometry resolves from workspace assets');
assert.strictEqual(vanilla.textures.all, 'minecraft:block/stone', 'vanilla child texture override is inherited into parent geometry');

// Blockbench 5.1.x ships three.js r129. Reproduce its asynchronous TextureLoader
// contract: load() returns a Texture before `image` is populated. The Studio face
// texture must return that same object rather than clone it while image is undefined.
let pendingTextureLoad = null;
class MockVec2 { constructor(){ this.x=0; this.y=0; } set(x,y){ this.x=x; this.y=y; return this; } }
class MockTexture {
  constructor(){ this.image=undefined; this.repeat=new MockVec2(); this.offset=new MockVec2(); this.center=new MockVec2(); this.encoding=0; this.flipY=true; this.needsUpdate=false; this.cloneCount=0; }
  clone(){ this.cloneCount++; const copy=new MockTexture(); copy.image=this.image; return copy; }
}
global.THREE.TextureLoader = class TextureLoader {
  load(url,onLoad,onProgress,onError){
    const texture=new MockTexture();
    pendingTextureLoad={texture,onLoad,onError,url};
    return texture;
  }
};
global.THREE.NearestFilter = 1003;
global.THREE.ClampToEdgeWrapping = 1001;
global.THREE.sRGBEncoding = 3001;
global.THREE.MathUtils = {degToRad(value){ return Number(value) * Math.PI / 180; }};
const faceTexture = hooks.faceTexture('minecraft:block/stone', [0,0,16,16], 0);
assert(faceTexture, 'face texture is created from resolved vanilla PNG');
assert.strictEqual(faceTexture, pendingTextureLoad.texture, 'face material keeps the original asynchronous TextureLoader texture object');
assert.strictEqual(faceTexture.cloneCount, 0, 'unfinished TextureLoader result is never cloned');
assert.strictEqual(faceTexture.encoding, global.THREE.sRGBEncoding, 'three.js r129 sRGBEncoding is configured');
pendingTextureLoad.texture.image = {width:16,height:16};
pendingTextureLoad.onLoad(pendingTextureLoad.texture);
assert.strictEqual(faceTexture.image.width, 16, 'the face texture receives the asynchronously decoded image');

const jarPath = path.join(tempProject, 'minecraft-test.jar');
fs.writeFileSync(jarPath, makeStoredZip({
  'assets/minecraft/models/block/jar_only.json': JSON.stringify({parent:'minecraft:block/cube_all', textures:{all:'minecraft:block/jar_only'}}),
  'assets/minecraft/models/block/cube_all.json': JSON.stringify({elements:[{from:[0,0,0],to:[16,16,16],faces:{down:{texture:'#all'},up:{texture:'#all'},north:{texture:'#all'},south:{texture:'#all'},west:{texture:'#all'},east:{texture:'#all'}}}]})
}));
assert.strictEqual(hooks.readZipEntry(jarPath, 'assets/minecraft/models/block/jar_only.json').toString('utf8').includes('cube_all'), true, 'Minecraft JAR/ZIP resource reader works');
hooks.getState().minecraft_asset_source = jarPath;
hooks.clearPreviewCaches();
assert(hooks.ensureLocalMinecraftAssetSource(), 'a usable Minecraft asset source is resolved');
assert.strictEqual(hooks.approximateBlockColor('minecraft:white_concrete'), 0xe8e8e8, 'asset-less block fallback uses readable approximate block colors');
const jarModel = hooks.loadVanillaModelDefinition('minecraft:jar_only');
assert(Array.isArray(jarModel.elements) && jarModel.elements.length === 1, 'vanilla model can inherit geometry directly from a selected Minecraft JAR');

function indexNodes(root, map = {}) {
  map[root.id] = root;
  (root.children || []).forEach(child => indexNodes(child, map));
  return map;
}
const before = indexNodes(fixture.root);
const after = indexNodes(compiled.root);
for (const id of Object.keys(before)) {
  assert(after[id], `node ${id} survived round-trip`);
  assert.strictEqual(after[id].type, before[id].type, `${id} type`);
  for (const key of Object.keys(before[id])) {
    if (key === 'children') continue;
    assert.deepStrictEqual(after[id][key], before[id][key], `${id}.${key}`);
  }
}

const invalidScale = JSON.parse(JSON.stringify(fixture));
invalidScale.root.children[0].transform.scale = [0, 1, 1];
createdCodec.load(invalidScale, {path: fixturePath, name: 'test.json'});
assert.throws(() => createdCodec.compile({raw: true}), /validation error/, 'zero transform scale is rejected before save');

const invalidHost = JSON.parse(JSON.stringify(fixture));
invalidHost.connections[0].action.id = 'not-a-resource-location';
createdCodec.load(invalidHost, {path: fixturePath, name: 'test.json'});
assert.throws(() => createdCodec.compile({raw: true}), /validation error/, 'invalid host action id is rejected before save');

const invalidHitbox = JSON.parse(JSON.stringify(fixture));
invalidHitbox.root.children.find(n => n.id === 'grid').children[1].interaction.shape.radius = -1;
createdCodec.load(invalidHitbox, {path: fixturePath, name: 'test.json'});
assert.throws(() => createdCodec.compile({raw: true}), /validation error/, 'invalid interaction shape is rejected before save');

const invalidBuiltinOverride = JSON.parse(JSON.stringify(fixture));
invalidBuiltinOverride.root.children.find(n => n.id === 'model').properties = {visible: {type: 'string', default: 'yes', sync: true}};
createdCodec.load(invalidBuiltinOverride, {path: fixturePath, name: 'test.json'});
assert.throws(() => createdCodec.compile({raw: true}), /validation error/, 'built-in Node3D property type overrides are rejected');

const invalidActionType = JSON.parse(JSON.stringify(fixture));
invalidActionType.connections[0].action.type = 'bad action';
createdCodec.load(invalidActionType, {path: fixturePath, name: 'test.json'});
assert.throws(() => createdCodec.compile({raw: true}), /validation error/, 'invalid unnamespaced action types are rejected');

fs.rmSync(tempProject, {recursive:true, force:true});
console.log('GFBS Console Studio round-trip + visual runtime smoke test: PASS');
registeredPlugin.options.onunload();
global.setTimeout = originalSetTimeout;
