/**
 * Quality model — how much capability survives quantization, and how to compare
 * a big-but-squeezed model against a small-but-precise one.
 *
 * Core insight from research: a larger model at low bit-rate often beats a
 * smaller model at high bit-rate — but only down to a floor (~3 bpw with
 * imatrix; below that degradation accelerates). We encode that as an effective
 * capability score.
 */

import type { ModelDescriptor, QuantSpec } from "../types.ts";

/**
 * Quality retention priors by effective bits-per-weight (vs fp16 = 1.0).
 * Derived from perplexity/benchmark literature in our teardown. imatrix and
 * dynamic (UD / EXL) allocation shift the curve up at the low end.
 */
export function qualityRetentionForBpw(bpw: number, opts?: { imatrix?: boolean; dynamic?: boolean }): number {
  // Base curve (no imatrix, static allocation).
  let q: number;
  if (bpw >= 8) q = 0.999;
  else if (bpw >= 6) q = 0.997;
  else if (bpw >= 5) q = 0.992;
  else if (bpw >= 4.5) q = 0.985;
  else if (bpw >= 4) q = 0.975;
  else if (bpw >= 3.5) q = 0.95;
  else if (bpw >= 3) q = 0.90;
  else if (bpw >= 2.5) q = 0.80;
  else if (bpw >= 2) q = 0.66;
  else q = 0.45;

  // imatrix calibration meaningfully recovers the low end (<=4bpw).
  if (opts?.imatrix && bpw <= 4) {
    q += (4 - bpw) * 0.04; // bigger boost the lower you go
  }
  // Dynamic per-layer allocation recovers a bit more.
  if (opts?.dynamic && bpw <= 4) {
    q += 0.02;
  }
  return Math.min(0.999, q);
}

/**
 * Effective capability of (model, quant) on a 0..1 scale.
 * = baseCapability (fp16 quality) * qualityRetention.
 *
 * This is what lets us correctly prefer e.g. a 7B@Q4 (0.78 * 0.975 = 0.76)
 * over a 1.5B@Q8 (0.45 * 0.999 = 0.45).
 */
export function effectiveCapability(model: ModelDescriptor, quant: QuantSpec): number {
  const retention =
    quant.qualityRetention ??
    qualityRetentionForBpw(quant.bitsPerWeight, { imatrix: quant.imatrix, dynamic: quant.dynamic });
  return model.baseCapability * retention;
}
