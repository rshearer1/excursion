// The build_scene.py placeholder monitor, rebuilt in three.js with the same names,
// sizes and positions. Blender (x, y, z) -> three (x, z, -y): the baffle faces +Z.

import * as THREE from "three";
import { FULL_TRAVEL_MM } from "./rig";
import type { Rig } from "./rigTypes";

const FILM_GAUGE_MM = 36; // full-frame sensor turned portrait: 36 mm tall

export function portraitCamera(focalMm: number, position: THREE.Vector3, lookAt: THREE.Vector3): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 9 / 16, 0.05, 20);
  cam.filmGauge = FILM_GAUGE_MM;
  cam.setFocalLength(focalMm);
  cam.position.copy(position);
  cam.lookAt(lookAt);
  return cam;
}

export function buildPlaceholder(): Rig {
  const root = new THREE.Group();
  root.name = "Placeholder";

  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.5, metalness: 0.05 });
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 0.24), cabinetMat);
  cabinet.name = "Cabinet";
  root.add(cabinet);

  const wooferMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 });
  const woofers: THREE.Mesh[] = [];
  for (const [name, y] of [["Woofer_L", 0.05], ["Woofer_R", -0.13]] as const) {
    const geo = new THREE.CylinderGeometry(0.085, 0.085, 0.02, 48);
    geo.rotateX(Math.PI / 2); // axis along Z (toward the camera)
    const m = new THREE.Mesh(geo, wooferMat);
    m.name = name;
    m.position.set(0.06, y, 0.125);
    root.add(m);
    woofers.push(m);
  }
  const wooferRest = 0.125;

  const tweeterMat = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.4,
    emissive: new THREE.Color(0.9, 0.95, 1.0),
    emissiveIntensity: 0,
  });
  const tweeter = new THREE.Mesh(new THREE.SphereGeometry(0.028, 32, 16), tweeterMat);
  tweeter.name = "Tweeter";
  tweeter.position.set(-0.07, 0.16, 0.125);
  root.add(tweeter);

  const slateMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: new THREE.Color(1.0, 0.55, 0.18),
    emissiveIntensity: 0,
  });
  const slate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), slateMat);
  slate.name = "Slate";
  slate.position.set(0, 0.48, -0.05);
  root.add(slate);

  const key = new THREE.SpotLight(0xffffff, 14, 6, Math.PI / 5, 0.5, 2);
  key.name = "KeyLight";
  key.position.set(0.7, 0.7, 0.7);
  key.target = cabinet;
  root.add(key);

  const rim = new THREE.SpotLight(new THREE.Color(0.55, 0.85, 0.9), 9, 6, Math.PI / 5, 0.6, 2);
  rim.name = "RimLight";
  rim.position.set(-0.8, 0.4, -0.4);
  rim.target = cabinet;
  root.add(rim);

  root.add(new THREE.HemisphereLight(0x223038, 0x05060a, 0.6));

  const wide = portraitCamera(50, new THREE.Vector3(0.05, 0.08, 1.35), new THREE.Vector3(0, 0.0, 0));
  wide.name = "Camera_Wide";
  const close = portraitCamera(60, new THREE.Vector3(0.42, 0.06, 0.72), new THREE.Vector3(0.04, -0.04, 0.1));
  close.name = "Camera_Close";

  return {
    root,
    setExcursion(mm) {
      const dz = (Math.min(FULL_TRAVEL_MM, Math.max(0, mm)) / 1000);
      for (const w of woofers) w.position.z = wooferRest + dz;
    },
    setTweeter(x) {
      tweeterMat.emissiveIntensity = x * 6;
    },
    setSlate(x) {
      slateMat.emissiveIntensity = x * 4;
    },
    setLights(k, r) {
      key.intensity = 14 * k;
      rim.intensity = 9 * r;
    },
    cameras: [wide, close],
    jets: woofers.map((w) => ({
      origin: [w.position.x, w.position.y, w.position.z + 0.012],
      axis: [0, 0, 1],
      halfAngleDeg: 22,
      reach: 0.35,
      speed: 0,
    })),
  };
}
