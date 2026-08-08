const assert = require('assert');
const path = require('path');

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

const fixturePath = '/tmp/project/src/main/resources/data/gfbs_main/gfbs_console/scenes/test.json';
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

console.log('GFBS Console Studio round-trip + validation smoke test: PASS');
registeredPlugin.options.onunload();
global.setTimeout = originalSetTimeout;
