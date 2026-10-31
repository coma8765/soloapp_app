import { avatar } from './scene.js';
const B = window.BABYLON;

// The downloaded CC0 base has a skin but no animation clips. Pose its linked
// transform nodes so Babylon updates the glTF skin on both CPU and GPU paths.
export class LocalAvatar {
  constructor(scene) {
    this.root = new B.TransformNode('local-player', scene);
    this.root.rotationQuaternion = B.Quaternion.Identity();
    this.root.setEnabled(false);
    this.fallback = avatar(scene, 0, true);
    this.fallback.parent = this.root;
    this.phase = 0;
    this.stride = 0;
    this.ready = this.load(scene);
  }

  async load(scene) {
    let container;
    try {
      container = await B.LoadAssetContainerAsync('/assets/avatar/player.glb', scene);
      if (this.root.isDisposed()) { container.dispose(); return false; }
      const skeleton = container.skeletons[0];
      if (!skeleton) throw Error('Avatar has no skeleton');
      const names = ['upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'Head'];
      const joints = new Map();
      for (const name of names) {
        const node = skeleton.bones.find(bone => bone.name === name)?.getTransformNode();
        if (!node?.rotationQuaternion) throw Error('Missing avatar joint: ' + name);
        const inverse = node.parent.computeWorldMatrix(true).clone().invert();
        joints.set(name, {
          node, rest: node.rotationQuaternion.clone(),
          x: B.Vector3.TransformNormal(B.Axis.X, inverse).normalize(),
          z: B.Vector3.TransformNormal(B.Axis.Z, inverse).normalize(),
        });
      }
      this.model = new B.TransformNode('human-avatar', scene);
      this.model.parent = this.root;
      // glTF faces +Z; the game's right-handed player frame faces -Z.
      this.model.rotation.y = Math.PI;
      this.model.scaling.setAll(1.8 / 1.81958638317883);
      this.model.position.y = .009509669616818428 * this.model.scaling.y;
      container.addAllToScene();
      for (const node of container.rootNodes) node.parent = this.model;
      for (const mesh of container.meshes) {
        mesh.isPickable = false;
        // Animated limbs may leave the tight T-pose bounds (notably in overview).
        if (mesh.skeleton) mesh.alwaysSelectAsActiveMesh = true;
      }
      this.joints = joints;
      this.skeleton = skeleton;
      this.container = container;
      this.pose(0);
      this.fallback.setEnabled(false);
      this.root.onDisposeObservable.addOnce(() => container.dispose());
      return true;
    } catch (error) {
      container?.dispose();
      this.error = error;
      console.warn('Local avatar: keeping the capsule fallback.', error);
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
