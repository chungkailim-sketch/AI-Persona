"""
TimesFM 2.5 (Apache-2.0 weights) backtest on Mintel wave series.

Hold-out design: for every complete series, forecast the final wave from the waves before it
(h=1), and the final two waves from the waves before those (h=2). Compare with baselines that
need no model: last value, context mean, linear drift, and seasonal naive (same month a year
earlier; waves are semi-annual, March and September).

Reports MAE in percentage points, the share of series where TimesFM beats last-value, and the
empirical coverage of TimesFM's q10–q90 band. A binomial sampling-error reference is printed,
because an error smaller than the survey's own sampling noise cannot be told apart from it.
"""
import json, math, sys, time
import numpy as np
import torch
import timesfm

series_path, out_path = sys.argv[1], sys.argv[2]
data = json.load(open(series_path))
S = data["series"]
# CPU budget: a seeded random sample (TFM_SAMPLE, default 1200) keeps a 2-core run to minutes.
import os, random
N = int(os.environ.get("TFM_SAMPLE", "1200"))
if N and len(S) > N:
    random.Random(20260922).shuffle(S)
    S = S[:N]
print(f"series in run: {len(S)}", flush=True)

torch.set_float32_matmul_precision("high")
t0 = time.time()
model = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
model.compile(timesfm.ForecastConfig(
    max_context=64, max_horizon=8, normalize_inputs=True,
    use_continuous_quantile_head=True, force_flip_invariance=True,
    infer_is_positive=True, fix_quantile_crossing=True,
))
load_s = time.time() - t0

def baselines(ctx, h):
    ctx = np.asarray(ctx, dtype=float)
    last = np.repeat(ctx[-1], h)
    mean = np.repeat(ctx.mean(), h)
    slope = np.polyfit(np.arange(len(ctx)), ctx, 1)[0] if len(ctx) >= 2 else 0.0
    drift = ctx[-1] + slope * np.arange(1, h + 1)
    # seasonal naive with period 2 (March ↔ March, September ↔ September)
    seas = np.array([ctx[-2 + (i % 2)] if len(ctx) >= 2 else ctx[-1] for i in range(h)])
    return {"last": last, "mean": mean, "drift": np.clip(drift, 0, 100), "seasonal": seas}

results = {}
for h in (1, 2):
    usable = [s for s in S if len(s["values"]) - h >= 2]
    ctxs = [np.asarray(s["values"][:-h], dtype=np.float32) for s in usable]
    tgts = [np.asarray(s["values"][-h:], dtype=float) for s in usable]
    t1 = time.time()
    point, quant = model.forecast(horizon=h, inputs=ctxs)
    infer_s = time.time() - t1
    err = {k: [] for k in ("timesfm", "last", "mean", "drift", "seasonal")}
    covered, beats, ties = 0, 0, 0
    widths = []
    for i, s in enumerate(usable):
        y = tgts[i]
        p = np.clip(point[i, :h], 0, 100)
        err["timesfm"].append(np.abs(p - y).mean())
        for k, v in baselines(s["values"][:-h], h).items():
            err[k].append(np.abs(v - y).mean())
        lo, hi = quant[i, :h, 1], quant[i, :h, 9]
        covered += int(np.all((y >= lo) & (y <= hi)))
        widths.append(float(np.mean(hi - lo)))
        d = err["timesfm"][-1] - err["last"][-1]
        beats += int(d < -1e-9); ties += int(abs(d) <= 1e-9)
    # sampling noise reference: binomial SE of a share at the series' final base
    se = []
    for s in usable:
        b = s["bases"][-1] or 0
        p = s["values"][-1] / 100
        if b > 0:
            se.append(100 * math.sqrt(max(p * (1 - p), 1e-6) / b))
    results[f"h{h}"] = {
        "series": len(usable),
        "mae_pp": {k: round(float(np.mean(v)), 3) for k, v in err.items()},
        "median_ae_pp": {k: round(float(np.median(v)), 3) for k, v in err.items()},
        "timesfm_beats_last_value_share": round(beats / len(usable), 3),
        "timesfm_q10_q90_coverage": round(covered / len(usable), 3),
        "timesfm_mean_band_width_pp": round(float(np.mean(widths)), 2),
        "sampling_se_pp_median": round(float(np.median(se)), 2) if se else None,
        "inference_seconds": round(infer_s, 2),
    }
    # by segment group
    for grp in ("all", "age groups"):
        idx = [i for i, s in enumerate(usable) if s["segment_group"].lower() == grp]
        if idx:
            results[f"h{h}"][f"mae_pp_{grp.replace(' ', '_')}"] = {k: round(float(np.mean([err[k][i] for i in idx])), 3) for k in err}

# A worked forecast: the next wave (September 2026) for three population series.
examples = []
pick = [s for s in S if s["segment_group"].lower() == "all" and s["response"] in ("Strongly agree", "Somewhat agree")][:6]
pt, qt = model.forecast(horizon=1, inputs=[np.asarray(s["values"], dtype=np.float32) for s in pick])
for i, s in enumerate(pick):
    examples.append({"market": s["market"], "statement": s["statement"], "response": s["response"],
                     "history": dict(zip(s["waves"], s["values"])),
                     "forecast_next_wave": round(float(pt[i, 0]), 1),
                     "q10": round(float(qt[i, 0, 1]), 1), "q90": round(float(qt[i, 0, 9]), 1)})

out = {"model": "google/timesfm-2.5-200m-pytorch", "device": "cpu", "load_seconds": round(load_s, 1),
       "results": results, "examples": examples}
json.dump(out, open(out_path, "w"), indent=2)
print(json.dumps(out, indent=2))
