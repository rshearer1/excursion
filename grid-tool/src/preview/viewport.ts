// The three.js viewport: portrait canvas, fog haze, dust cloud, bloom. Renderer glue only —
// every number that matters comes from rig.ts (tested) via RigState.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { makeDust, stepDust, type DustCloud, type RigState } from "./rig";
import type { Rig } from "./rigTypes";

const DUST_COUNT = 20000;
const DUST_BOX = { min: [-0.45, -0.55, -0.25] as const, max: [0.45, 0.65, 0.95] as const };
/** cone m/s -> air m/s at the mouth */
const JET_GAIN = 8;

function softDot(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PreviewViewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly dust: DustCloud;
  private readonly dustGeo: THREE.BufferGeometry;
  private rig: Rig;
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement, rig: Rig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.background = new THREE.Color(0x04060a);
    this.scene.fog = new THREE.FogExp2(0x04060a, 0.55);

    this.dust = makeDust(DUST_COUNT, 2026, DUST_BOX);
    this.dustGeo = new THREE.BufferGeometry();
    this.dustGeo.setAttribute("position", new THREE.BufferAttribute(this.dust.pos, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.0035,
      sizeAttenuation: true,
      map: softDot(),
      color: new THREE.Color(0.85, 0.8, 0.7),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.dustGeo, dustMat);
    points.name = "Dust";
    points.frustumCulled = false;
    this.scene.add(points);

    this.rig = rig;
    this.scene.add(rig.root);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, rig.cameras[0]!);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 456), 0.55, 0.5, 0.8));
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  /** Swap in a different rig (e.g. the glTF export arrived after the placeholder). */
  setRig(rig: Rig): void {
    this.scene.remove(this.rig.root);
    this.rig = rig;
    this.scene.add(rig.root);
  }

  resize(): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth || 216));
    const h = Math.round((w * 16) / 9);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    for (const c of this.rig.cameras) {
      c.aspect = 9 / 16;
      c.updateProjectionMatrix();
    }
  }

  render(state: RigState, dt: number): void {
    const rig = this.rig;
    rig.setExcursion(state.excursionMm);
    rig.setTweeter(state.tweeter);
    rig.setSlate(state.slate);
    rig.setLights(state.key, state.rim);

    const step = Math.min(Math.max(dt, 0), 0.1);
    this.time += step;
    for (const j of rig.jets) j.speed = state.coneVelocity * JET_GAIN;
    stepDust(this.dust, step, rig.jets, { drag: 0.9, turbulence: 0.03, time: this.time, box: DUST_BOX });
    (this.dustGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    const cam = rig.cameras[state.cameraIndex % rig.cameras.length] ?? rig.cameras[0]!;
    this.renderPass.camera = cam;
    this.composer.render();
  }

  dispose(): void {
    this.renderer.dispose();
    this.dustGeo.dispose();
  }
}
