// Loads blender/scenes/<scene>.glb from the linked project folder and binds it by the
// kit-contract names. Returns null when there is no export yet (the placeholder is used).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FULL_TRAVEL_MM } from "./rig";
import type { Rig } from "./rigTypes";
import { portraitCamera } from "./placeholder";

async function readGlb(dir: FileSystemDirectoryHandle, scene: string): Promise<ArrayBuffer | null> {
  try {
    const blender = await dir.getDirectoryHandle("blender");
    const scenes = await blender.getDirectoryHandle("scenes");
    const file = await scenes.getFileHandle(`${scene}.glb`);
    return await (await file.getFile()).arrayBuffer();
  } catch {
    return null;
  }
}

function emissiveOf(obj: THREE.Object3D | undefined): THREE.MeshStandardMaterial | null {
  if (!(obj instanceof THREE.Mesh)) return null;
  const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  return m instanceof THREE.MeshStandardMaterial ? m : null;
}

export async function loadSceneGltf(dir: FileSystemDirectoryHandle, scene: string): Promise<Rig | null> {
  const buf = await readGlb(dir, scene);
  if (!buf) return null;
  const gltf = await new GLTFLoader().parseAsync(buf, "");
  const root = gltf.scene;

  const woofers = ["Woofer_L", "Woofer_R"]
    .map((n) => root.getObjectByName(n))
    .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  const tweeterMat = emissiveOf(root.getObjectByName("Tweeter"));
  const slateMat = emissiveOf(root.getObjectByName("Slate"));
  const key = root.getObjectByName("KeyLight");
  const rim = root.getObjectByName("RimLight") ?? root.getObjectByName("RimLeft") ?? root.getObjectByName("TopBack");
  const keyBase = key instanceof THREE.Light ? key.intensity : 0;
  const rimBase = rim instanceof THREE.Light ? rim.intensity : 0;

  const cameras = gltf.cameras.filter((c): c is THREE.PerspectiveCamera => c instanceof THREE.PerspectiveCamera);
  for (const c of cameras) c.aspect = 9 / 16;
  if (cameras.length === 0) {
    cameras.push(portraitCamera(60, new THREE.Vector3(0, 0.03, 1.05), new THREE.Vector3(0, 0.03, 0)));
  }

  const jets = woofers.map((w) => {
    const p = new THREE.Vector3();
    w.getWorldPosition(p);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
    return {
      origin: [p.x, p.y, p.z] as const,
      axis: [axis.x, axis.y, axis.z] as const,
      radius: 0.16,
      reach: 0.6,
      speed: 0,
    };
  });
  const cabinet = root.getObjectByName("Cabinet") ?? root.getObjectByName("Hero") ?? null;
  let solid: Rig["solid"];
  if (cabinet) {
    const b = new THREE.Box3().setFromObject(cabinet);
    solid = { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
  }

  return {
    root,
    setExcursion(mm) {
      const v = Math.min(1, Math.max(-1, mm / FULL_TRAVEL_MM)); // the shape key's slider runs -1..1
      for (const w of woofers) {
        const idx = w.morphTargetDictionary?.["Excursion"];
        if (idx !== undefined && w.morphTargetInfluences) w.morphTargetInfluences[idx] = v;
      }
    },
    setTweeter(x) {
      if (tweeterMat) tweeterMat.emissiveIntensity = x * 6;
    },
    setSlate(x) {
      if (slateMat) slateMat.emissiveIntensity = x * 4;
    },
    setLights(k, r) {
      if (key instanceof THREE.Light) key.intensity = keyBase * k;
      if (rim instanceof THREE.Light) rim.intensity = rimBase * r;
    },
    cameras,
    jets,
    ...(solid ? { solid } : {}),
  };
}
