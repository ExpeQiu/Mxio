import * as THREE from 'three';
import type { FkResult, JointDef, LinkDef, MechanismDef } from '../core/types.js';

export type JointHit = { pick: 'joint'; jointId: string; linkId: string };

function linkMesh(link: LinkDef, mech: MechanismDef): THREE.Object3D {
  const group = new THREE.Group();
  group.name = link.id;
  if (link.id === 'world') return group;

  const color = new THREE.Color(link.color ?? '#64748b');
  const radius = link.radius ?? 0.012;
  const length = Math.max(link.length ?? 0.04, 0.02);
  const jointDef = mech.joints.find((j) => j.child === link.id);
  const isBox =
    link.shape === 'box' ||
    ((mech.kind === 'quadruped' || mech.kind === 'humanoid' || mech.kind === 'vehicle') &&
      (link.id === 'body' || link.id === 'torso' || link.id === 'chassis'));

  if (isBox) {
    const size = link.box ?? ([0.16, 0.1, 0.04] as const);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 }),
    );
    group.add(box);
    if (jointDef) group.add(hitSphere(jointDef, 0.022));
    return group;
  }

  if (mech.kind === 'vehicle' && link.id.startsWith('w_')) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.018, 18),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 }),
    );
    if (jointDef) {
      wheel.userData = { pick: 'joint', jointId: jointDef.id, linkId: jointDef.child };
    }
    group.add(wheel);
    if (jointDef) group.add(hitSphere(jointDef, radius * 1.15));
    return group;
  }

  const geom = new THREE.CylinderGeometry(radius, radius * 0.85, length, 12);
  geom.rotateZ(-Math.PI / 2);
  geom.translate(length / 2, 0, 0);
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.45 }));
  if (jointDef) {
    mesh.userData = { pick: 'joint', jointId: jointDef.id, linkId: jointDef.child };
  }
  group.add(mesh);
  if (jointDef) group.add(hitSphere(jointDef, Math.max(radius * 1.6, 0.016)));
  return group;
}

function hitSphere(joint: JointDef, radius: number): THREE.Mesh {
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0x334155,
      metalness: 0.2,
      roughness: 0.35,
    }),
  );
  hit.name = `hit:${joint.id}`;
  hit.userData = { pick: 'joint', jointId: joint.id, linkId: joint.child } satisfies JointHit;
  return hit;
}

export function collectJointHits(root: THREE.Object3D): THREE.Mesh[] {
  const hits: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh && obj.userData?.pick === 'joint') hits.push(obj as THREE.Mesh);
  });
  return hits;
}

export function setHitHighlight(mesh: THREE.Mesh | null, on: boolean): void {
  const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
  if (!mat?.emissive) return;
  mat.emissive.setHex(on ? 0xf59e0b : 0x334155);
  mat.color.setHex(on ? 0xfbbf24 : 0xf8fafc);
}

export function buildMechanism(scene: THREE.Scene, mech: MechanismDef): Map<string, THREE.Object3D> {
  const nodes = new Map<string, THREE.Object3D>();
  for (const link of mech.links) {
    const obj = linkMesh(link, mech);
    scene.add(obj);
    nodes.set(link.id, obj);
  }
  return nodes;
}

export function applyFk(nodes: Map<string, THREE.Object3D>, fk: FkResult): void {
  for (const [id, pose] of Object.entries(fk.links)) {
    const obj = nodes.get(id);
    if (!obj) continue;
    const r = pose.rot;
    const m = new THREE.Matrix4().set(
      r[0][0], r[0][1], r[0][2], pose.xyz[0],
      r[1][0], r[1][1], r[1][2], pose.xyz[1],
      r[2][0], r[2][1], r[2][2], pose.xyz[2],
      0, 0, 0, 1,
    );
    obj.position.set(pose.xyz[0], pose.xyz[1], pose.xyz[2]);
    obj.quaternion.setFromRotationMatrix(m);
  }
}

export function disposeNodes(scene: THREE.Scene, nodes: Map<string, THREE.Object3D>): void {
  for (const obj of nodes.values()) {
    scene.remove(obj);
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    });
  }
  nodes.clear();
}
