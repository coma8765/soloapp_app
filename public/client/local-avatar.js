import { avatar } from './scene.js';
import { DEFAULT_AVATAR, findAvatar } from './avatar-catalog.js';
const B = window.BABYLON;

// Rigged bases use procedural poses; explicitly static catalogue entries keep
// their authored pose and use the same player transform and camera visibility.
export class LocalAvatar {
  constructor(scene, initialId = DEFAULT_AVATAR) {
    this.scene = scene;
    this.root = new B.TransformNode('local-player', scene);
    this.root.rotationQuaternion = B.Quaternion.Identity();
    this.root.setEnabled(false);
    this.fallback = avatar(scene, 0, true);
    this.fallback.parent = this.root;
    this.phase = 0;
    this.stride = 0;
    this.generation = 0;
    this.root.onDisposeObservable.addOnce(() => { this.generation++; this.container?.dispose(); });
    this.select(initialId);
  }

  select(id) {
    const definition = findAvatar(id);
    if (!definition) return Promise.resolve(false);
    this.ready = this.load(definition, ++this.generation);
    return this.ready;
  }

  async load(definition, generation) {
    const scene = this.scene;
    let container;
    try {
      container = await B.LoadAssetContainerAsync(definition.url, scene);
      if (this.root.isDisposed() || generation !== this.generation) { container.dispose(); return false; }
      const skeleton = container.skeletons[0];
      const rigged = definition.rigged !== false;
      if (rigged && !skeleton) throw Error('Avatar has no skeleton');
      const names = ['upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'Head'];
      const joints = new Map();
      for (const name of rigged ? names : []) {
        const node = skeleton.bones.find(bone => bone.name === name)?.getTransformNode();
        if (!node?.rotationQuaternion) throw Error('Missing avatar joint: ' + name);
        const inverse = node.parent.computeWorldMatrix(true).clone().invert();
        joints.set(name, {
          node, rest: node.rotationQuaternion.clone(),
          x: B.Vector3.TransformNormal(B.Axis.X, inverse).normalize(),
          z: B.Vector3.TransformNormal(B.Axis.Z, inverse).normalize(),
        });
      }
      const previousContainer = this.container, previousModel = this.model;
      const model = new B.TransformNode('human-avatar', scene);
      model.parent = this.root;
      // glTF faces +Z; the game's right-handed player frame faces -Z.
      model.rotation.y = Math.PI;
      model.scaling.setAll(1.8 / definition.height);
      model.position.y = -definition.floor * model.scaling.y;
      container.addAllToScene();
      for (const node of container.rootNodes) node.parent = model;
      for (const mesh of container.meshes) {
        mesh.isPickable = false;
        // Animated limbs may leave the tight T-pose bounds (notably in overview).
        if (mesh.skeleton) mesh.alwaysSelectAsActiveMesh = true;
      }
      this.joints = rigged ? joints : null;
      this.model = model;
      this.skeleton = skeleton;
      this.container = container;
      if (this.joints) this.pose(0);
      this.id = definition.id;
      this.error = null;
      this.fallback.setEnabled(false);
      previousContainer?.dispose();
      previousModel?.dispose();
      return true;
    } catch (error) {
      container?.dispose();
      if (generation !== this.generation || this.root.isDisposed()) return false;
      this.error = error;
      console.warn('Local avatar: keeping the previous avatar or capsule fallback.', error);
      return false;
    }
  }

  rotate(name, x, z = 0) {
    const joint = this.joints.get(name);
    const delta = B.Quaternion.RotationAxis(joint.x, x)
      .multiply(B.Quaternion.RotationAxis(joint.z, z));
    joint.node.rotationQuaternion.copyFrom(delta.multiply(joint.rest));
  }

  pose(pitch) {
    const swing = Math.sin(this.phase) * this.stride;
    this.rotate('upperarm_l', swing * .4, -1.35);
    this.rotate('upperarm_r', -swing * .4, 1.35);
    this.rotate('thigh_l', -swing * .55);
    this.rotate('thigh_r', swing * .55);
    this.rotate('calf_l', Math.max(0, swing) * .7);
    this.rotate('calf_r', Math.max(0, -swing) * .7);
    this.rotate('Head', -Math.max(-.7, Math.min(.7, pitch)));
  }

  update(dt, speed, pitch, visible) {
    this.root.setEnabled(visible);
    if (this.model && !this.joints) return;
    if (!this.joints) {
      this.fallback.getChildMeshes().find(mesh => mesh.name === 'look-direction').rotation.x = pitch;
      return;
    }
    // Travel drives the cadence; stopping blends back to the relaxed idle pose.
    const moving = Math.min(1, speed / 2.5);
    this.stride += (moving - this.stride) * (1 - Math.exp(-dt * 12));
    this.phase = (this.phase + speed * dt * 3) % (2 * Math.PI);
    this.pose(pitch);
  }
}
