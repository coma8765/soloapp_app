import { laboratorySite } from './lab-site.js';
import { orientation, vec } from './scene.js';
const B = window.BABYLON;

export class Laboratory {
  constructor(scene, terrain, planet, professors) {
    Object.assign(this, { scene, terrain, planet });
    this.colliders = []; this.obstacles = []; this.vessels = []; this.tables = [];
    this.root = new B.TransformNode('Lakeside laboratory veranda', scene);
    this.root.setEnabled(false); this.visible = false;
    this.ready = professors.ready.then(() => {
      this.site = laboratorySite(terrain, planet.trees.map(p => p.asArray()), professors.sites.map(g => g.position));
      this.root.position.copyFrom(vec(this.site.position));
      this.root.rotationQuaternion = orientation(vec(this.site.forward), vec(this.site.up));
      this.root.computeWorldMatrix(true);
      return true;
    }).catch(error => { this.error = error; console.warn('Laboratory:', error); return false; });
  }

  material(name, color, alpha = 1) {
    const m = new B.StandardMaterial(name, this.scene);
    m.diffuseColor = B.Color3.FromHexString(color); m.specularColor.set(.12, .12, .12); m.alpha = alpha;
    return m;
  }

  box(name, size, position, material, obstacle = false, parent = this.root) {
    const mesh = B.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    mesh.parent = parent; mesh.position.copyFromFloats(...position); mesh.material = material;
    mesh.isPickable = parent === this.root;
    if (mesh.isPickable) this.colliders.push(mesh);
    if (obstacle) this.obstacles.push({ x: position[0], z: position[2], halfX: size[0] / 2, halfZ: size[2] / 2, minY: position[1] - size[1] / 2, maxY: position[1] + size[1] / 2 });
    return mesh;
  }

  sign(name, lines, width, height, position, parent = this.root) {
    const mesh = B.MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    mesh.parent = parent; mesh.position.copyFromFloats(...position); mesh.isPickable = false;
    mesh.rotation.y = Math.PI;
    const texture = new B.DynamicTexture(name + ' text', { width: 1024, height: Math.round(1024 * height / width) }, this.scene, true);
    const c = texture.getContext(), h = texture.getSize().height;
    c.fillStyle = '#163c40'; c.fillRect(0, 0, 1024, h); c.strokeStyle = '#a9d8be'; c.lineWidth = 10; c.strokeRect(5, 5, 1014, h - 10);
    c.textAlign = 'center'; c.fillStyle = '#f1f5df';
    for (let i = 0; i < lines.length; i++) { c.font = `${i ? 38 : 52}px sans-serif`; c.fillText(lines[i], 512, h * (i + 1) / (lines.length + 1) + 16); }
    texture.update();
    const material = this.material(name + ' material', '#ffffff');
    material.diffuseTexture = texture; material.emissiveColor = B.Color3.White(); material.disableLighting = true; material.backFaceCulling = false;
    mesh.material = material;
    return mesh;
  }

  build() {
    const wood = this.material('Laboratory warm timber', '#a78054');
    const darkWood = this.material('Laboratory beams', '#5c4938');
    const frame = this.material('Laboratory teal metal', '#245c5b');
    const porcelain = this.material('Laboratory ivory worktops', '#edf0df');
    const gold = this.material('Laboratory brass details', '#bba16a');
    this.box('Veranda foundation', [7.2, .2, 5.6], [0, -.1, 0], darkWood);
    for (let i = 0; i < 24; i++) this.box('Deck board', [.285, .035, 5.56], [-3.45 + i * .3, -.0175, 0], wood);
    for (const x of [-3.4, 3.4]) for (const z of [-2.6, 2.6]) {
      this.box('Veranda support', [.25, 4.5, .25], [x, .9, z], darkWood, true);
      this.box('Post cap', [.34, .08, .34], [x, 3.17, z], gold);
    }
    this.box('Pergola left beam', [.2, .25, 6.1], [-3.4, 3.05, 0], darkWood);
    this.box('Pergola right beam', [.2, .25, 6.1], [3.4, 3.05, 0], darkWood);
    for (let i = 0; i < 11; i++) this.box('Open pergola slat', [7.5, .12, .18], [0, 3.21, -2.7 + i * .54], wood);
    for (const x of [-3.5, 3.5]) {
      this.box('Side handrail', [.12, .12, 5.6], [x, 1.02, 0], frame, true);
      for (let z = -2.5; z <= 2.5; z += 1) this.box('Side baluster', [.065, 1, .065], [x, .5, z], frame);
    }
    this.box('Rear handrail', [7, .12, .12], [0, 1.02, 2.7], frame, true);
    for (const x of [-2.35, 2.35]) this.box('Entrance handrail', [2.3, .12, .12], [x, 1.02, -2.7], frame, true);
    const ramp = this.box('Laboratory access ramp', [2.3, .1, Math.hypot(3, this.site.drop)], [0, -this.site.drop / 2 - .05, -4.3], wood);
    ramp.rotation.x = -Math.atan2(this.site.drop, 3);
    this.sign('Laboratory entrance', ['ПОЛЕВАЯ ЛАБОРАТОРИЯ', 'ОЗЕРО / ИССЛЕДОВАНИЯ ВОДЫ'], 3.5, .75, [0, 2.55, -2.67]);
    this.sign('Laboratory board', ['ЛАБОРАТОРИЯ ВОДЫ', 'Наблюдайте · сравнивайте · исследуйте'], 3.1, .75, [0, 2.05, 2.62]);
    for (const [index, x] of [-1.65, 1.65].entries()) {
      const table = this.box('Laboratory table ' + (index + 1), [2.3, .12, 1.1], [x, .88, .8], porcelain, true);
      this.tables.push(table);
      for (const dx of [-.98, .98]) for (const z of [.36, 1.24]) this.box('Workbench leg', [.08, .82, .08], [x + dx, .41, z], frame);
      this.box('Workbench shelf', [2.1, .07, .85], [x, .3, .8], wood);
      this.box('Sample tray', [.65, .025, .45], [x, .953, .7], frame);
      this.sign('Sample label ' + index, [index ? 'ОБРАЗЕЦ B · 30 мл' : 'ОБРАЗЕЦ A · 40 мл'], .8, .19, [x, .8, .235]);
      this.createVessel(index ? 'sample-b' : 'sample-a', [x, .97, .7], index ? '#edb249' : '#41bad3', index ? 30 : 40, frame, gold);
    }
  }

  createVessel(id, position, color, volumeMl, standMaterial, rimMaterial) {
    const root = new B.TransformNode(id, this.scene);
    root.parent = this.root; root.position.copyFromFloats(...position); root.rotationQuaternion = B.Quaternion.Identity();
    root.metadata = { kind: 'lab-vessel', vesselId: id };
    const glass = this.material(id + ' glass', '#cae7e6', .25); glass.backFaceCulling = false; glass.specularColor.set(.9, .9, .9); glass.specularPower = 128;
    const liquid = this.material(id + ' liquid', color); liquid.emissiveColor = liquid.diffuseColor.scale(.15);
    const cylinder = (name, height, diameter, y, material, cap = B.Mesh.CAP_ALL) => {
      const mesh = B.MeshBuilder.CreateCylinder(name, { height, diameter, tessellation: 32, cap }, this.scene);
      mesh.parent = root; mesh.position.y = y; mesh.material = material; mesh.isPickable = false; return mesh;
    };
    cylinder(id + ' glass wall', .38, .115, .25, glass, B.Mesh.NO_CAP);
    const bottom = B.MeshBuilder.CreateSphere(id + ' rounded base', { diameter: .115, segments: 16 }, this.scene);
    bottom.parent = root; bottom.position.y = .065; bottom.scaling.y = .75; bottom.material = glass; bottom.isPickable = false;
    const liquidHeight = .32 * volumeMl / 100;
    cylinder(id + ' contents', liquidHeight, .095, .045 + liquidHeight / 2, liquid);
    const rim = B.MeshBuilder.CreateTorus(id + ' open rim', { diameter: .115, thickness: .014, tessellation: 32 }, this.scene);
    rim.parent = root; rim.position.y = .44; rim.material = rimMaterial; rim.isPickable = false;
    // The stand stays on the bench; a future grab moves only the vessel root.
    this.box(id + ' stand base', [.22, .025, .22], [position[0], position[1] + .0125, position[2]], standMaterial);
    const holder = B.MeshBuilder.CreateTorus(id + ' holder', { diameter: .14, thickness: .018, tessellation: 24 }, this.scene);
    holder.parent = this.root; holder.position.copyFromFloats(position[0], position[1] + .08, position[2]); holder.material = standMaterial; holder.isPickable = false;
    const pickMesh = cylinder(id + ' interaction volume', .48, .18, .24, glass);
    pickMesh.visibility = 0; pickMesh.isPickable = true; pickMesh.metadata = root.metadata;
    this.vessels.push({ id, root, pickMesh, capacityMl: 100, contents: [{ id: id + '-liquid', color, volumeMl }], restPosition: root.position.clone(), restRotation: root.rotationQuaternion.clone() });
  }

  update(position = this.scene.activeCamera.globalPosition) {
    const visible = !!this.site && this.planet.visible && B.Vector3.Distance(position, this.root.position) < (this.visible ? 16 : 10);
    if (visible && !this.built) { this.build(); this.built = true; }
    if (visible !== this.visible) { this.visible = visible; this.root.setEnabled(visible); }
  }

  localPosition(position) { return B.Vector3.TransformCoordinates(position, B.Matrix.Invert(this.root.computeWorldMatrix(true))); }

  groundRadius(direction) {
    if (!this.visible) return null;
    const { site } = this, dx = B.Vector3.Dot(direction, vec(site.right)), dy = B.Vector3.Dot(direction, vec(site.up)), dz = B.Vector3.Dot(direction, vec(site.back));
    if (dy < .85) return null;
    const deck = site.base / dy;
    if (Math.abs(dx * deck) <= 3.6 && Math.abs(dz * deck) <= 2.8) return deck;
    const slope = site.drop / 3, ramp = (site.base + slope * 2.8) / (dy - slope * dz);
    if (Math.abs(dx * ramp) <= 1.15 && dz * ramp >= -5.8 && dz * ramp < -2.8) return ramp;
    return null;
  }

  resolveMovement(position) {
    if (!this.visible) return position;
    const p = this.localPosition(position);
    if (Math.abs(p.x) > 5 || Math.abs(p.z) > 7) return position;
    for (const b of this.obstacles) {
      if (p.y > b.maxY || p.y + 1.7 < b.minY) continue;
      const dx = p.x - b.x, dz = p.z - b.z;
      const overlapX = b.halfX + .35 - Math.abs(dx), overlapZ = b.halfZ + .35 - Math.abs(dz);
      if (overlapX <= 0 || overlapZ <= 0) continue;
      if (overlapX < overlapZ) p.x += (dx >= 0 ? 1 : -1) * overlapX;
      else p.z += (dz >= 0 ? 1 : -1) * overlapZ;
    }
    return B.Vector3.TransformCoordinates(p, this.root.getWorldMatrix());
  }
}
