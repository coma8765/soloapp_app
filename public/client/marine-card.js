const B = window.BABYLON;
const WIDTH = 1024, HEIGHT = 1280;

// A temporary world-space card; it follows the animal instead of covering the screen.
export class MarineCard {
  constructor(scene) {
    this.scene = scene;
    this.mesh = B.MeshBuilder.CreatePlane('Marine animal information', { width: 1, height: HEIGHT / WIDTH }, scene);
    this.mesh.rotationQuaternion = B.Quaternion.Identity();
    this.mesh.renderingGroupId = 3; this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.texture = new B.DynamicTexture('Marine information text', { width: WIDTH * 2, height: HEIGHT * 2 }, scene, true);
    this.texture.hasAlpha = true; this.texture.anisotropicFilteringLevel = 8;
    const material = new B.StandardMaterial('Marine information material', scene);
    material.diffuseTexture = this.texture; material.useAlphaFromDiffuseTexture = true;
    material.emissiveColor = B.Color3.White(); material.disableLighting = true; material.backFaceCulling = false;
    this.mesh.material = material;
    this.line = B.MeshBuilder.CreateLines('Animal information connector', { points: [B.Vector3.Zero(), B.Vector3.Up()], updatable: true }, scene);
    this.line.color = new B.Color3(.65, 1, .88); this.line.isPickable = false; this.line.renderingGroupId = 3;
    this.hide();
  }

  draw(species, lake) {
    const c = this.texture.getContext(); c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, WIDTH, HEIGHT);
    c.beginPath(); c.roundRect(3, 3, WIDTH - 6, HEIGHT - 6, 30);
    c.fillStyle = '#102c38f5'; c.fill(); c.strokeStyle = '#a9e5d3'; c.lineWidth = 3; c.stroke();
    const text = (value, x, y, size, color = '#eefaf7') => {
      c.font = `${size}px sans-serif`; c.fillStyle = color; c.textAlign = 'left'; c.fillText(value, x, y);
    };
    const wrap = (value, x, y, size, width, color) => {
      c.font = `${size}px sans-serif`;
      let line = '';
      for (const word of value.split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (line && c.measureText(next).width > width) { text(line, x, y, size, color); y += size * 1.3; line = word; }
        else line = next;
      }
      if (line) text(line, x, y, size, color);
      return y + size * 1.3;
    };
    text(`ОЗЕРО ${lake + 1} / МОРСКИЕ ЖИТЕЛИ`, 44, 58, 23, '#9dcec6');
    text(species.name, 44, 122, 47);
    text(species.scientificName, 44, 163, 27, '#adc8d2');
    c.beginPath(); c.roundRect(38, 190, WIDTH - 76, 112, 18); c.fillStyle = species.bottom ? '#514536' : '#244b46'; c.fill();
    text(species.danger, 58, 233, 32, species.bottom ? '#ffe0b3' : '#c0f5d4');
    text(species.dangerDetail, 58, 274, 26, '#e5eeeb');
    let y = 348;
    for (const [label, value] of species.rows) {
      text(label, 44, y, 22, '#86b7bc');
      y = wrap(value, 44, y + 36, 30, WIDTH - 88, '#eefaf7') + 25;
    }
    text('Учебная морская экспозиция · масштаб увеличен', 44, 1185, 23, '#a8c5c8');
    text(species.sourceLabel, 44, 1224, 22, '#a8c5c8');
    text('Справка проверена 31.10.2026 · отведите луч, чтобы скрыть', 44, 1259, 21, '#8aaeb7');
    this.texture.update();
    this.contentBottom = y;
  }

  show(entity) {
    if (this.entity === entity) return;
    this.draw(entity.species, entity.lakeIndex);
    this.entity = entity; this.side = null; this.mesh.setEnabled(true); this.line.setEnabled(true);
    const accessible = document.getElementById('marine-description');
    if (accessible) accessible.textContent = `${entity.species.name}. ${entity.species.dangerDetail} ${entity.species.rows.map(([key, value]) => key + ': ' + value).join('. ')}`;
  }

  hide() {
    this.entity = null; this.mesh.setEnabled(false); this.line.setEnabled(false);
    const accessible = document.getElementById('marine-description');
    if (accessible?.textContent) accessible.textContent = '';
  }

  update(camera) {
    if (!this.entity) return;
    camera.computeWorldMatrix(true);
    const world = camera.getWorldMatrix();
    const right = B.Vector3.TransformNormal(B.Axis.X, world).normalize();
    const up = B.Vector3.TransformNormal(B.Axis.Y, world).normalize();
    const forward = B.Vector3.TransformNormal(new B.Vector3(0, 0, -1), world).normalize();
    const anchor = this.entity.anchor();
    const offset = anchor.subtract(camera.globalPosition);
    const depth = B.Vector3.Dot(offset, forward);
    if (depth < .2) { this.mesh.setEnabled(false); this.line.setEnabled(false); return; }
    this.mesh.setEnabled(true); this.line.setEnabled(true);
    const halfHeight = depth * Math.tan(camera.fov / 2);
    const halfWidth = halfHeight * this.scene.getEngine().getAspectRatio(camera);
    const width = Math.min(Math.max(1.1, depth * .65), 5, halfWidth * 1.5, halfHeight * 1.35 * WIDTH / HEIGHT);
    const height = width * HEIGHT / WIDTH;
    const ax = B.Vector3.Dot(offset, right), ay = B.Vector3.Dot(offset, up);
    const side = this.side ??= ax > 0 ? -1 : 1;
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const x = clamp(ax + side * (width * .56 + this.entity.species.displayLength * .3), -halfWidth + width * .53, halfWidth - width * .53);
    const y = clamp(ay + height * .12, -halfHeight + height * .53, halfHeight - height * .53);
    this.mesh.position.copyFrom(camera.globalPosition.add(forward.scale(depth)).add(right.scale(x)).add(up.scale(y)));
    this.mesh.scaling.setAll(width);
    world.decompose(undefined, this.mesh.rotationQuaternion);
    B.MeshBuilder.CreateLines('Animal information connector', { points: [anchor, this.mesh.position.subtract(right.scale(side * width * .49))], instance: this.line }, this.scene);
  }
}
