import { lakeProfessorSites } from './lake-sites.js';
import { orientation, vec } from './scene.js';
const B = window.BABYLON;

export class LakeProfessors {
  constructor(scene, terrain, planet) {
    Object.assign(this, { scene, terrain, planet });
    this.guides = []; this.visible = true; this.nearest = null; this.error = null;
    this.ready = this.load();
  }
  async load() {
    try {
      const response = await fetch('/assets/lakes.json');
      if (!response.ok) throw Error('Не удалось загрузить берега озёр');
      const navigation = await response.json();
      const sites = lakeProfessorSites(this.terrain, navigation.lakes, this.planet.trees.map(tree => tree.asArray()));
      this.container = await B.LoadAssetContainerAsync('/assets/professor/professor-einstein.glb', this.scene);
      this.container.addAllToScene();
      const template = new B.TransformNode('professor-template', this.scene);
      for (const node of this.container.rootNodes) node.parent = template;
      const bounds = template.getHierarchyBoundingVectors(true), height = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(height) || height <= 0) throw Error('Некорректная модель профессора');
      const scale = 1.9 / height;
      template.scaling.setAll(scale);
      template.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2);
      this.template = template;
      for (const site of sites) {
        const root = new B.TransformNode('lake-professor-' + site.id, this.scene);
        root.position.copyFrom(vec(site.position)); root.rotationQuaternion = orientation(vec(site.forward), vec(site.up));
        // Authored glTF faces +Z; player-facing directions use local -Z.
        const facing = new B.TransformNode('professor-facing-' + site.id, this.scene);
        facing.parent = root; facing.rotation.y = Math.PI;
        const model = template.clone('professor-model-' + site.id, facing);
        for (const mesh of model.getChildMeshes()) mesh.isPickable = false;
        const sign = B.MeshBuilder.CreatePlane('professor-sign-' + site.id, { width: 2.4, height: .8 }, this.scene);
        sign.position.copyFrom(root.position.add(vec(site.up).scale(2.45)));
        sign.rotationQuaternion = B.Quaternion.Identity(); sign.isPickable = false;
        const texture = new B.DynamicTexture('professor-sign-texture-' + site.id, { width: 1024, height: 342 }, this.scene, true);
        texture.hasAlpha = true;
        const material = new B.StandardMaterial('professor-sign-material-' + site.id, this.scene);
        material.diffuseTexture = texture; material.emissiveColor = B.Color3.White();
        material.disableLighting = true; material.backFaceCulling = false;
        sign.material = material;
        const guide = { ...site, root, model, sign, texture, near: false, state: '' };
        this.guides.push(guide); this.draw(guide);
      }
      template.setEnabled(false);
      this.setVisible(this.visible);
      return true;
    } catch (error) {
      this.error = error; this.container?.dispose(); this.template?.dispose();
      console.warn('Lake professors:', error.message); return false;
    }
  }
  setVisible(visible) {
    this.visible = visible;
    for (const guide of this.guides) { guide.root.setEnabled(visible); guide.sign.setEnabled(visible); }
    if (!visible) this.nearest = null;
  }
  draw(guide) {
    const title = `Профессор · озеро ${guide.id + 1}`;
    const message = guide.near ? 'Здравствуйте! Рад вас видеть.' : 'Подойдите познакомиться';
    const state = title + message;
    if (guide.state === state) return;
    guide.state = state;
    const c = guide.texture.getContext(); c.clearRect(0, 0, 1024, 342);
    c.fillStyle = guide.near ? '#204e4bf2' : '#183642eb'; c.beginPath(); c.roundRect(3, 3, 1018, 336, 32); c.fill();
    c.strokeStyle = guide.near ? '#c7ebad' : '#718e99'; c.lineWidth = 4; c.stroke();
    c.textAlign = 'center'; c.fillStyle = '#e9f5ed'; c.font = '42px sans-serif'; c.fillText(title, 512, 100);
    c.font = '38px sans-serif'; c.fillText(message, 512, 194);
    c.font = '23px sans-serif'; c.fillStyle = '#b4cbd0'; c.fillText('Professor Einstein · klava88 · CC BY 4.0', 512, 285);
    guide.texture.update();
  }
  update(dt, player, camera, visible = true) {
    if (visible !== this.visible) this.setVisible(visible);
    this.nearest = null;
    if (!visible) return;
    let closest = Infinity;
    for (const guide of this.guides) {
      const delta = player.position.subtract(guide.root.position), distance = delta.length();
      // Hysteresis avoids flickering greetings at the distance threshold.
      guide.near = distance < (guide.near ? 6.5 : 5.5);
      if (guide.near && distance < closest) { this.nearest = guide.id; closest = distance; }
      const up = vec(guide.up), forward = guide.near ? delta : vec(guide.forward);
      if (B.Vector3.Cross(forward, up).lengthSquared() > .001) {
        const rotation = orientation(forward, up);
        guide.root.rotationQuaternion = B.Quaternion.Slerp(guide.root.rotationQuaternion, rotation, 1 - Math.exp(-dt * 5));
      }
      const view = camera.globalPosition.subtract(guide.sign.position);
      if (B.Vector3.Cross(view, up).lengthSquared() > .001) guide.sign.rotationQuaternion = orientation(view.negate(), up);
      this.draw(guide);
    }
  }
  dispose() {
    for (const guide of this.guides) { guide.root.dispose(); guide.sign.dispose(false, true); }
    this.template?.dispose(); this.container?.dispose(); this.guides = [];
  }
}
