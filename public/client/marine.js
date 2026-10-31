import { MARINE_SPECIES } from './marine-catalog.js';
import { MarineCard } from './marine-card.js';
import { WATER_RADIUS, clamp } from '../shared/world.js';
import { orientation, vec } from './scene.js';
const B = window.BABYLON;

export class MarineLife {
  constructor(scene, terrain, planet, player, canvas, panel, xr, gamepad) {
    Object.assign(this, { scene, terrain, planet, player, canvas, panel, xr, gamepad });
    this.entities = []; this.exhibits = []; this.containers = []; this.errors = [];
    this.card = new MarineCard(scene); this.pointer = null;
    this.ready = this.load();
    canvas.addEventListener('pointermove', event => {
      const rect = canvas.getBoundingClientRect(); this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    });
    canvas.addEventListener('pointerleave', () => { this.pointer = null; });
    canvas.addEventListener('click', event => {
      if (!this.available || document.pointerLockElement === canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ray = scene.createPickingRay(event.clientX - rect.left, event.clientY - rect.top, B.Matrix.Identity(), scene.activeCamera);
      const entity = this.pick(ray);
      if (entity) { event.stopImmediatePropagation(); this.inspect(entity); }
    }, true);
  }

  get available() { return this.planet.visible && !this.panel.visible && !this.player.overview; }

  async load() {
    try {
      const response = await fetch('/assets/lakes.json');
      if (!response.ok) throw Error('Карты озёр недоступны');
      const data = await response.json();
      this.lakes = data.lakes.map((lake, index) => ({ index, up: vec(lake.up), side: vec(lake.side), tangent: vec(lake.tangent) }));
      for (const lake of this.lakes) this.createExhibit(lake);
      // Load once per species; clones share geometry, textures and materials.
      for (const species of MARINE_SPECIES) {
        try {
          const container = await B.LoadAssetContainerAsync(species.model, this.scene);
          this.containers.push(container);
          for (const material of container.materials) {
            if (material instanceof B.PBRMaterial) { material.metallic = 0; material.roughness = .68; material.environmentIntensity = .7; }
          }
          for (const lake of this.lakes) for (let slot = 0; slot < species.count; slot++) this.createAnimal(container, species, lake, slot);
        } catch (error) { this.errors.push(species.name); console.warn('Marine model:', species.id, error); }
      }
    } catch (error) { this.errors.push('озёра'); console.warn('Marine exhibit:', error); }
    return this.errors.length === 0;
  }

  point(lake, x, z, height = 0) {
    const up = lake.up.scale(WATER_RADIUS).add(lake.side.scale(x)).add(lake.tangent.scale(z)).normalize();
    return up.scale(this.terrain.radius(up.asArray()) + height);
  }

  createAnimal(container, species, lake, slot) {
    const root = new B.TransformNode(`${species.id}-lake-${lake.index}-${slot}`, this.scene);
    root.rotationQuaternion = B.Quaternion.Identity();
    const model = new B.TransformNode('Marine model scale', this.scene); model.parent = root;
    const entries = container.instantiateModelsToScene(name => root.name + ':' + name, false, { doNotInstantiate: true });
    for (const node of entries.rootNodes) node.parent = model;
    for (const mesh of model.getChildMeshes()) { mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = false; }
    model.computeWorldMatrix(true);
    const bounds = model.getHierarchyBoundingVectors(true);
    const size = bounds.max.subtract(bounds.min), center = bounds.max.add(bounds.min).scale(.5);
    const scale = species.displayLength / Math.max(size.x, size.y, size.z, .001);
    model.scaling.setAll(scale);
    model.position.copyFrom(center.scale(-scale));
    if (species.bottom) model.position.y = -bounds.min.y * scale;
    // Authored FBX/glTF axes are preserved; the surrounding root follows the lake's tangent frame.
    const proxy = B.MeshBuilder.CreateSphere('Marine hover volume', { diameter: 1, segments: 8 }, this.scene);
    proxy.parent = root; proxy.scaling.set(Math.max(.3, size.x * scale), Math.max(.24, size.y * scale), Math.max(.3, size.z * scale));
    proxy.position.y = species.bottom ? size.y * scale * .5 : 0;
    proxy.visibility = 0; proxy.isPickable = true;
    const entity = { root, model, entries, proxy, species, lake, lakeIndex: lake.index, slot, time: slot * 2 + lake.index, active: false,
      anchor: () => root.position.add(root.position.normalizeToNew().scale(species.bottom ? size.y * scale * .5 : 0)) };
    proxy.metadata = { marineEntity: entity };
    for (const group of entries.animationGroups) { group.start(true, species.bottom ? .55 : .8); group.pause(); }
    root.setEnabled(false);
    this.entities.push(entity);
    this.place(entity, 0);
  }

  createExhibit(lake) {
    const root = new B.TransformNode('Lake habitat ' + lake.index, this.scene);
    const sand = new B.StandardMaterial('Pale underwater stones ' + lake.index, this.scene);
    sand.diffuseColor = new B.Color3(.36, .44, .39); sand.specularColor.set(.05, .05, .05);
    const green = new B.StandardMaterial('Marine plants ' + lake.index, this.scene);
    green.diffuseColor = new B.Color3(.19, .43, .29); green.specularColor.set(.04, .04, .04); green.backFaceCulling = false;
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.39996, radius = 2.3 + (i % 4) * .65;
      const p = this.point(lake, Math.cos(angle) * radius, Math.sin(angle) * radius);
      if (p.length() > WATER_RADIUS - .65) continue;
      const stone = B.MeshBuilder.CreateSphere('Underwater stone', { diameter: 1, segments: 8 }, this.scene);
      stone.parent = root; stone.position.copyFrom(p); stone.rotationQuaternion = orientation(lake.tangent, p.normalizeToNew());
      stone.scaling.set(.35 + (i % 3) * .16, .18 + (i % 2) * .1, .4 + (i % 4) * .12);
      stone.material = sand; stone.isPickable = false;
      if (i % 2) continue;
      for (let branch = 0; branch < 3; branch++) {
        const left = [], right = [];
        for (let step = 0; step <= 6; step++) {
          const t = step / 6, width = Math.sin(t * Math.PI) * .065;
          const bend = Math.sin(t * 2.2 + branch) * t * .2;
          left.push(new B.Vector3(bend - width, t * (.55 + branch * .15), t * t * .16));
          right.push(new B.Vector3(bend + width, t * (.55 + branch * .15), t * t * .16));
        }
        const stem = B.MeshBuilder.CreateRibbon('Underwater leaf', { pathArray: [left, right], sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
        const up = p.normalizeToNew();
        stem.parent = root; stem.position.copyFrom(p.add(up.scale(.1)).add(lake.side.scale((branch - 1) * .15)));
        stem.rotationQuaternion = orientation(lake.tangent.add(lake.side.scale((branch - 1) * .15)), up);
        stem.material = green; stem.isPickable = false;
      }
    }
    this.exhibits.push({ root, lake });
  }

  place(entity, dt) {
    entity.time += dt * (this.card.entity === entity ? .18 : 1);
    const { lake, species, slot } = entity, t = entity.time * (species.bottom ? .075 : .25);
    const radius = species.bottom ? 1.6 : 2.1 + slot * .65;
    const x = Math.cos(t + slot * 2.1) * radius, z = Math.sin(t + slot * 2.1) * radius * .75;
    const bottom = this.point(lake, x, z);
    const up = bottom.normalizeToNew();
    const floor = bottom.length();
    const r = species.bottom ? floor + .03 : clamp(WATER_RADIUS - .75 - slot * .22 + Math.sin(t * 1.7) * .14, floor + .45, WATER_RADIUS - .35);
    entity.root.position.copyFrom(up.scale(r));
    const forward = lake.side.scale(-Math.sin(t + slot * 2.1)).add(lake.tangent.scale(Math.cos(t + slot * 2.1) * .75));
    entity.root.rotationQuaternion.copyFrom(orientation(forward, up));
    entity.proxy.computeWorldMatrix(true);
  }

  pick(ray) {
    if (!this.available) return null;
    ray.length = 18;
    const hit = this.scene.pickWithRay(ray, mesh => mesh.isEnabled() && (!!mesh.metadata?.marineEntity || mesh === this.planet.terrain || mesh === this.planet.bark));
    return hit?.hit && hit.distance <= 18 ? hit.pickedMesh.metadata?.marineEntity || null : null;
  }

  inspect(entity) { this.lastHover = performance.now(); this.card.show(entity); }

  updateXR(frame, referenceSpace, origin) {
    this.xrTarget = null; this.xrAt = performance.now();
    if (!this.available) return;
    for (const source of frame.session.inputSources) {
      const ray = this.panel.xrRay(frame, source, referenceSpace, origin);
      const entity = ray && this.pick(ray);
      if (entity) { this.xrTarget = entity; break; }
    }
  }

  update(dt) {
    const camera = this.scene.activeCamera, now = performance.now();
    for (const exhibit of this.exhibits) exhibit.root.setEnabled(this.planet.visible && B.Vector3.Distance(camera.globalPosition, exhibit.lake.up.scale(WATER_RADIUS)) < 26);
    for (const entity of this.entities) {
      const active = this.planet.visible && B.Vector3.Distance(camera.globalPosition, entity.lake.up.scale(WATER_RADIUS)) < 24;
      if (active !== entity.active) {
        entity.active = active; entity.root.setEnabled(active);
        for (const group of entity.entries.animationGroups) active ? group.play(true) : group.pause();
      }
      if (active) this.place(entity, dt);
    }
    const hint = document.getElementById('marine-status');
    const nearby = this.available && this.entities.some(entity => entity.active);
    if (hint) { hint.hidden = !this.available || (!nearby && !this.errors.length); hint.textContent = this.errors.length ? 'Не удалось загрузить: ' + this.errors.join(', ') + '. Обновите страницу.' : 'Морская экспозиция · наведите курсор, прицел или VR-луч на животное'; }
    if (!this.available) { this.card.hide(); this.candidate = null; return; }
    let target = null;
    if (this.xr.active) target = now - (this.xrAt || 0) < 250 ? this.xrTarget : null;
    else if (document.pointerLockElement === this.canvas || this.gamepad.active) target = this.pick(camera.getForwardRay(18));
    else if (this.pointer) target = this.pick(this.scene.createPickingRay(this.pointer.x, this.pointer.y, B.Matrix.Identity(), camera));
    if (target !== this.candidate) { this.candidate = target; this.candidateAt = now; }
    if (target && now - this.candidateAt > 120) this.inspect(target);
    if (this.card.entity && (!this.card.entity.active || now - this.lastHover > 1100)) this.card.hide();
    this.card.update(camera);
  }
}
