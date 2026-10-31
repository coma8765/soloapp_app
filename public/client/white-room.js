import { ROOM_MAP, ROOM_HALF, ROOM_HEIGHT, roomSpawn } from '../shared/room.js';
const B = window.BABYLON;

export class WhiteRoom {
  constructor(scene, player, planet, fish) {
    Object.assign(this, { scene, player, planet, fish });
    this.root = new B.TransformNode('White room map', scene);
    this.colliders = [];
    const material = (name, color, emissive = false) => {
      const m = new B.StandardMaterial(name, scene);
      m.diffuseColor = B.Color3.FromHexString(color);
      m.specularColor.set(.12, .12, .12);
      if (emissive) { m.emissiveColor = m.diffuseColor; m.disableLighting = true; }
      return m;
    };
    const wall = material('White plaster', '#ffffff');
    const floor = material('Pearl floor', '#e6e9eb');
    const trim = material('Wall skirting', '#c4cdd2');
    const seam = material('Floor tile seams', '#cdd5db');
    const light = material('Ceiling light strips', '#f3fcff', true);
    const blue = material('Spawn markers', '#72b9c9');
    const box = (name, size, position, m, collide = false) => {
      const mesh = B.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
      mesh.parent = this.root; mesh.position.copyFromFloats(...position); mesh.material = m;
      mesh.isPickable = collide;
      if (collide) this.colliders.push(mesh);
      return mesh;
    };
    box('Room floor', [24.8, .3, 24.8], [0, -.15, 0], floor, true);
    box('Room ceiling', [24.8, .3, 24.8], [0, ROOM_HEIGHT + .15, 0], wall, true);
    for (const sign of [-1, 1]) {
      box('White side wall', [.4, ROOM_HEIGHT, 24.8], [sign * (ROOM_HALF + .2), ROOM_HEIGHT / 2, 0], wall, true);
      box('White end wall', [24.8, ROOM_HEIGHT, .4], [0, ROOM_HEIGHT / 2, sign * (ROOM_HALF + .2)], wall, true);
      box('Side skirting', [.06, .14, 24], [sign * (ROOM_HALF - .03), .07, 0], trim);
      box('End skirting', [24, .14, .06], [0, .07, sign * (ROOM_HALF - .03)], trim);
      box('Ceiling light', [.22, .025, 20], [sign * 7, ROOM_HEIGHT - .02, 0], light);
    }
    for (let n = -10; n <= 10; n += 2) {
      box('Floor grid x', [.015, .002, 24], [n, .001, 0], seam);
      box('Floor grid z', [24, .002, .015], [0, .001, n], seam);
    }
    for (let slot = 0; slot < 8; slot++) {
      const marker = B.MeshBuilder.CreateCylinder('Spawn ' + (slot + 1), { diameter: 1.1, height: .008, tessellation: 48 }, scene);
      marker.parent = this.root; marker.position.copyFromFloats(...roomSpawn(slot)); marker.position.y = .005;
      marker.material = blue; marker.isPickable = false;
    }
    box('Front wall accent', [5, .04, .02], [0, 2.3, -ROOM_HALF + .015], blue);
    this.light = new B.HemisphericLight('Room ambient light', B.Vector3.Up(), scene);
    this.light.intensity = .95; this.light.groundColor = new B.Color3(.7, .73, .76);
    this.light.diffuse = new B.Color3(1, .99, .98);
    this.root.setEnabled(false); this.light.setEnabled(false);
  }

  async prepare() {
    const materials = new Set();
    for (const mesh of this.root.getChildMeshes()) {
      if (materials.has(mesh.material)) continue;
      materials.add(mesh.material);
      await mesh.material.forceCompilationAsync(mesh);
    }
  }

  enter(server, userId) {
    if (this.serverId === server.id) return;
    if (this.serverId) this.leave();
    const slot = server.members.find(member => member.id === userId)?.spawn_slot ?? 0;
    this.saved = { position: this.player.position.clone(), forward: this.player.forward.clone(), pitch: this.player.pitch };
    this.serverId = server.id;
    this.root.setEnabled(true); this.light.setEnabled(true);
    this.planet.setVisible(false); this.fish.reset();
    this.scene.clearColor = new B.Color4(.94, .96, .97, 1);
    this.player.roomColliders = this.colliders;
    this.player.setMap(ROOM_MAP, roomSpawn(slot));
  }

  leave() {
    if (!this.serverId) return;
    this.serverId = 0;
    this.root.setEnabled(false); this.light.setEnabled(false);
    this.planet.setVisible(true); this.fish.reset();
    this.scene.clearColor = new B.Color4(.64, .77, .82, 1);
    this.player.roomColliders = [];
    this.player.setMap('planet', this.saved.position.asArray());
    this.player.forward.copyFrom(this.saved.forward); this.player.pitch = this.saved.pitch;
    this.player.update(0);
  }
}
