import { fftMag } from "./fft";

export interface FrameFeatures {
  frameCount: number;
  bass: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  /** Spectral flux (positive magnitude change per frame) — raw onset strength. */
  flux: Float32Array;
}

export interface FeatureOptions {
  fps?: number;
  fftSize?: number;
  bassHz?: [number, number];
  midHz?: [number, number];
  highHz?: [number, number];
}

/**
 * Per-frame band energies and spectral flux from mono PCM.
 * One frame per 1/fps, Hann-windowed FFT centred on the frame time.
 * A full-scale sine peaks near 1.0 in its band bin before band averaging.
 */
export function extractFeatures(
  pcm: Float32Array,
  sampleRate: number,
  options: FeatureOptions = {},
): FrameFeatures {
  const {
    fps = 30,
    fftSize = 2048,
    bassHz = [20, 150],
    midHz = [150, 2000],
    highHz = [2000, 10000],
  } = options;

  const frameCount = Math.ceil((pcm.length / sampleRate) * fps);
  const bass = new Float32Array(frameCount);
  const mid = new Float32Array(frameCount);
  const high = new Float32Array(frameCount);
  const flux = new Float32Array(frameCount);

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const binHz = sampleRate / fftSize;
  const norm = fftSize / 4; // Hann-windowed full-scale sine peaks at N/4
  const binRange = ([lo, hi]: [number, number]): [number, number] => [
    Math.max(0, Math.ceil(lo / binHz)),
    Math.min(fftSize / 2, Math.ceil(hi / binHz)),
  ];
  const bandMean = (mags: Float32Array, [lo, hi]: [number, number]): number => {
    if (hi <= lo) return 0;
    let sum = 0;
    for (let k = lo; k < hi; k++) sum += mags[k]!;
    return sum / norm / (hi - lo);
  };

  const bassBins = binRange(bassHz);
  const midBins = binRange(midHz);
  const highBins = binRange(highHz);

  const scratch = new Float32Array(fftSize);
  let prevMags: Float32Array | null = null;

  for (let f = 0; f < frameCount; f++) {
    const center = Math.round((f / fps) * sampleRate);
    const start = center - fftSize / 2;
    for (let i = 0; i < fftSize; i++) {
      const src = start + i;
      scratch[i] = (src >= 0 && src < pcm.length ? pcm[src]! : 0) * window[i]!;
    }
    const mags = fftMag(scratch);

    bass[f] = bandMean(mags, bassBins);
    mid[f] = bandMean(mags, midBins);
    high[f] = bandMean(mags, highBins);

    if (prevMags) {
      let sum = 0;
      for (let k = 0; k < mags.length; k++) {
        const d = mags[k]! - prevMags[k]!;
        if (d > 0) sum += d;
      }
      flux[f] = sum / norm;
    }
    prevMags = mags;
  }

  return { frameCount, bass, mid, high, flux };
}
