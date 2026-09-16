/**
 * UQIE (Unified Quantitative Intelligence Engine) - Solvers
 * Contains standard mathematical and quantitative functions.
 */

// =============================================
// 1. Normal CDF N(x)
// =============================================
function normalCDF(x) {
  let t = 1 / (1 + 0.2316419 * Math.abs(x));
  let d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// =============================================
// 2. Inverse Normal CDF using Acklam's high-precision rational approximation
// =============================================
function inverseNormalCDF(p) {
  const a1 = -39.6968302866538, a2 = 220.946098424521, a3 = -275.928510446969;
  const a4 = 138.357751867269, a5 = -30.6647980661472, a6 = 2.50662827745924;
  
  const b1 = -54.4760987982241, b2 = 161.585836858041, b3 = -155.698979859887;
  const b4 = 66.8013118877197, b5 = -13.2806815528857;
  
  const c1 = -0.00778489400243029, c2 = -0.322396458041136, c3 = -2.40075827716184;
  const c4 = -2.54973253934373, c5 = 4.37466414146497, c6 = 2.93816398269878;
  
  const d1 = 0.00778469570904146, d2 = 0.32246712907004, d3 = 2.445134137143;
  const d4 = 3.75440866190742;

  const p_low = 0.02425;
  const p_high = 1 - p_low;

  if (p <= 0 || p >= 1) return NaN;

  let q, r;
  if (p < p_low) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
           ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  } else if (p <= p_high) {
    q = p - 0.5;
    r = q * q;
    return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
           (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
            ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
}

// =============================================
// 3. Binary Option IV Solver (Fixed direction in Bisection fallback)
// =============================================
function solveIV(marketPrice, S, K, T) {
  if (T <= 0 || K <= 0 || S <= 0) return 0;
  if (marketPrice <= 0.001 || marketPrice >= 0.999) return 0;
  
  // High/low bounds for bisection
  let lowVol = 0.0001;
  let highVol = 8.0; 
  let sigma = 0.5;
  
  for (let i = 0; i < 40; i++) {
    let d2 = (Math.log(S / K) - 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
    let C_est = normalCDF(d2);
    let diff = C_est - marketPrice;
    
    if (Math.abs(diff) < 1e-8) break;
    
    // Vega of binary option
    let vega = Math.exp(-d2 * d2 / 2) / Math.sqrt(2 * Math.PI) *
               (-Math.log(S / K) / (sigma * sigma * Math.sqrt(T)) - 0.5 * Math.sqrt(T));
               
    if (Math.abs(vega) < 1e-10) {
      let d2_plus = (Math.log(S / K) - 0.5 * (sigma + 0.01) * (sigma + 0.01) * T) / ((sigma + 0.01) * Math.sqrt(T));
      let localVegaSign = normalCDF(d2_plus) > C_est ? 1 : -1;
      
      if ((diff > 0 && localVegaSign > 0) || (diff < 0 && localVegaSign < 0)) {
        highVol = sigma;
      } else {
        lowVol = sigma;
      }
      sigma = (lowVol + highVol) / 2;
    } else {
      let step = diff / vega;
      let next = sigma - step;
      
      if (next <= lowVol || next >= highVol || Math.abs(step) > 2.0) {
        if ((diff > 0 && vega > 0) || (diff < 0 && vega < 0)) {
          highVol = sigma;
        } else {
          lowVol = sigma;
        }
        sigma = (lowVol + highVol) / 2;
      } else {
        sigma = next;
      }
    }
  }
  return sigma;
}

export {
  normalCDF,
  inverseNormalCDF,
  solveIV
};
