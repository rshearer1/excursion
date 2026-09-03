/**
 * Attack/release envelope follower.
 * attack and release are per-step smoothing factors in (0, 1]:
 * env += factor * (x - env), attack when rising, release when falling.
 */
export function envelopeFollow(
  input: ArrayLike<number>,
  attack: number,
  release: number,
): Float32Array {
  const out = new Float32Array(input.length);
  let env = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    env += (x > env ? attack : release) * (x - env);
    out[i] = env;
  }
  return out;
}
