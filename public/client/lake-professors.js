import { lakeProfessorSites } from './lake-sites.js';
import { orientation, vec } from './scene.js';
const B = window.BABYLON;

export class LakeProfessors {
  constructor(scene, terrain, planet, recorder = null) {
    Object.assign(this, { scene, terrain, planet, recorder });
    this.guides = []; this.visible = true; this.nearest = null; this.error = null;
    this.sites = []; this.ready = this.loadSites();
  }
  async loadSites() {
    try {
      const response = await fetch('/assets/lakes.json');
      if (!response.ok) throw Error('Не удалось загрузить берега озёр');
      const navigation = await response.json();
      this.sites = lakeProfessorSites(this.terrain, navigation.lakes, this.planet.trees.map(tree => tree.asArray()));
      return true;
    } catch (error) { this.error = error; console.warn('Lake sites:', error); return false; }
  }
  async loadTemplate() {
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
    template.setEnabled(false);
    return template;
  }
  async loadGuide(site) {
    try {
      this.loading ||= this.loadTemplate();
      const template = await this.loading;
      const root = new B.TransformNode('lake-professor-' + site.id, this.scene);
      root.position.copyFrom(vec(site.position)); root.rotationQuaternion = orientation(vec(site.forward), vec(site.up));
      // Authored glTF faces +Z; player-facing directions use local -Z.
      const facing = new B.TransformNode('professor-facing-' + site.id, this.scene);
      facing.parent = root; facing.rotation.y = Math.PI;
      const model = template.clone('professor-model-' + site.id, facing);
      model.setEnabled(true);
      for (const mesh of model.getChildMeshes()) mesh.isPickable = false;
      const sign = B.MeshBuilder.CreatePlane('professor-sign-' + site.id, this.recorder ? { width: 2.8, height: 2.1 } : { width: 2.4, height: .8 }, this.scene);
      sign.position.copyFrom(root.position.add(vec(site.up).scale(this.recorder ? 3.1 : 2.45)));
      sign.rotationQuaternion = B.Quaternion.Identity(); sign.isPickable = false;
      const texture = new B.DynamicTexture('professor-sign-texture-' + site.id, { width: 1024, height: this.recorder ? 768 : 342 }, this.scene, true);
      texture.hasAlpha = true;
      const material = new B.StandardMaterial('professor-sign-material-' + site.id, this.scene);
      material.diffuseTexture = texture; material.emissiveColor = B.Color3.White();
      material.disableLighting = true; material.backFaceCulling = false;
      sign.material = material;
      const guide = { ...site, root, model, sign, texture, near: false, state: '', site };
      this.guides.push(guide); this.draw(guide);
      root.setEnabled(false); sign.setEnabled(false);
      return true;
    } catch (error) {
      this.error = error;
      console.warn('Lake professors:', error.message); return false;
    }
  }
  setVisible(visible) {
    this.visible = visible;
    for (const guide of this.guides) { guide.root.setEnabled(visible && !!guide.site.active); guide.sign.setEnabled(visible && !!guide.site.active); }
    if (!visible) this.nearest = null;
  }
  draw(guide) {
    if (this.recorder) { this.drawSpeech(guide); return; }
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
  drawSpeech(guide) {
    const recorder = this.recorder, active = this.nearest === guide.id;
    const text = recorder.record(guide.id).text;
    const status = active ? recorder.error || (recorder.pending ? 'Подключаю голосовой чат…' : recorder.enabled ? '● Слушаю голосовой чат · локальный Whisper' : 'Включите микрофон голосового чата — я запишу ваши слова.') : 'Подойдите, чтобы поговорить';
    const state = JSON.stringify([text, status, recorder.enabled, recorder.pending, active, recorder.tracks.size]);
    if (guide.state === state) return; guide.state = state;
    const c = guide.texture.getContext(); c.clearRect(0,0,1024,768);
    c.fillStyle = active ? '#204e4bf2' : '#183642eb'; c.beginPath(); c.roundRect(3,3,1018,762,32); c.fill();
    c.strokeStyle = active ? '#c7ebad' : '#718e99'; c.lineWidth = 4; c.stroke();
    c.textAlign = 'left'; c.fillStyle = '#e9f5ed'; c.font = '42px sans-serif'; c.fillText(`Профессор · озеро ${guide.id + 1}`,42,76);
    c.font = '28px sans-serif'; c.fillStyle = recorder.error && active ? '#ffc7ae' : '#c5e9d1';
    const wrap = (value, width) => {
      const lines = []; let line = '';
      for (const word of value.split(/\s+/)) {
        if (line && c.measureText(line + ' ' + word).width > width) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word;
      }
      if (line) lines.push(line); return lines;
    };
    wrap(status,940).slice(0,2).forEach((line,i)=>c.fillText(line,42,130+i*36));
    c.font = '32px sans-serif'; c.fillStyle = '#f1f8f2';
    wrap(text || 'Здесь появятся ваши слова. Аудио не сохраняется на диск.',940).slice(-7).forEach((line,i)=>c.fillText(line,42,230+i*43));
    c.fillStyle = '#c5e9d1'; c.textAlign = 'center'; c.font = '28px sans-serif';
    c.fillText('Запись включается вместе с микрофоном голосового чата',512,635);
    c.font = '22px sans-serif'; c.fillStyle = '#b4cbd0'; c.fillText('Только ваша речь · Professor Einstein / klava88 · CC BY 4.0',512,725);
    guide.texture.update();
  }
  update(dt, player, camera, visible = true) {
    if (visible !== this.visible) this.setVisible(visible);
    this.nearest = null;
    for (const site of this.sites) {
      site.active = visible && B.Vector3.Distance(player.position, vec(site.position)) < (site.active ? 30 : 24);
      if (site.active && !site.loading) site.loading = this.loadGuide(site);
    }
    if (!visible) { this.recorder?.setTarget(null); return; }
    let closest = Infinity;
    for (const guide of this.guides) {
      guide.root.setEnabled(!!guide.site.active); guide.sign.setEnabled(!!guide.site.active);
      if (!guide.site.active) { guide.near = false; continue; }
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
    }
    this.recorder?.setTarget(this.nearest);
    for (const guide of this.guides) this.draw(guide);
  }
  dispose() {
    for (const guide of this.guides) { guide.root.dispose(); guide.sign.dispose(false, true); }
    this.template?.dispose(); this.container?.dispose(); this.guides = [];
  }
}
