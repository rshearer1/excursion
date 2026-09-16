import type * as THREE from "three";
import type { Box, Jet } from "./rig";

/**
 * What the viewport drives. Both the placeholder speaker and a glTF export of the
 * scene-kit produce one of these, bound by the kit-contract object names
 * (Woofer_L, Woofer_R, Tweeter, Slate, KeyLight, RimLight, Camera*).
 */
export interface Rig {
  root: THREE.Object3D;
  /** cone travel, mm (0..6) */
  setExcursion(mm: number): void;
  setTweeter(x: number): void;
  setSlate(x: number): void;
  setLights(key: number, rim: number): void;
  /** at least one; cuts alternate through them */
  cameras: THREE.PerspectiveCamera[];
  /** air jets in scene space, speed filled per frame from cone velocity */
  jets: Jet[];
  /** the cabinet's bounds in scene space: dust is born outside it and flows around it */
  solid?: Box;
}
