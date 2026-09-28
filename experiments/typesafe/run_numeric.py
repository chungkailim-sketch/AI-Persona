"""
E1b — near-boundary numeric claims. Jev's documentation says it is not a calculator; this measures
what that means for claim checking, and whether doing the arithmetic in code first fixes it.

Variant A (raw): claim and evidence as text; the model compares the numbers.
Variant B (code-first): code extracts both figures and states the difference; the model judges
only whether the claim's wording is compatible with that stated difference.
"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
from run import ask  # noqa: E402  (reuses the retrying client; run.py's body is guarded below)

series = json.load(open(sys.argv[1]))["series"]
rnd = random.Random(11)
pop = [s for s in series if s["segment_group"].lower() == "all" and 25 <= s["values"][-1] <= 70]
rnd.shuffle(pop)
cases = []
for s in pop[:30]:
    v = round(s["values"][-1]); stmt = s["statement"].strip().rstrip("."); resp = s["response"].lower()
    k = len(cases) % 5
    if k == 0: fig, label, words = v + rnd.choice([-2, -1, 1, 2]), "supported", "around {f}%"
    elif k == 1: fig, label, words = v + rnd.choice([-12, -9, 9, 12]), "contradicted", "around {f}%"
    elif k == 2:
        # "more than half": supported only if the real figure exceeds 50
        fig, label, words = None, ("supported" if v > 50 else "contradicted"), "more than half"
    elif k == 3: fig, label, words = v + rnd.choice([4, 5]), "contradicted", "at least {f}%"
    else: fig, label, words = v - rnd.choice([4, 5]), "supported", "at least {f}%"
    phr = words.format(f=fig) if fig is not None else words
    claim = f"In {s['market']}, {phr} of adults {resp} that \"{stmt.lower()}\"."
    ev = f"Mintel Global Consumer, {s['market']}, {s['waves'][-1]}: {s['values'][-1]}% of adults answered \"{s['response']}\" to \"{stmt}\" (base {s['bases'][-1]})."
    diff = None if fig is None else round(fig - s["values"][-1], 1)
    computed = (f"The evidence figure is {s['values'][-1]}%. " + (f"The claim's figure is {fig}%, a difference of {diff:+} percentage points." if fig is not None else "The claim gives no figure."))
    cases.append({"label": label, "claim": claim, "evidence": ev, "computed": computed, "value": s["values"][-1], "claim_figure": fig})

CRIT = {"supported": "The evidence figure is compatible with the claim's wording (for 'around', within 3 percentage points; for 'at least X', the figure is X or more; for 'more than half', the figure is above 50%).",
        "contradicted": "The evidence figure is not compatible with the claim's wording."}
def one(c):
    r = ask({"claim": c["claim"], "evidence": c["evidence"], "arithmetic_done_in_code": c["computed"]},
            {"raw": {"type": "choice", "instructions": "Is the figure in `evidence` compatible with `claim`?", "criteria": CRIT},
             "code_first": {"type": "choice", "instructions": "Using `arithmetic_done_in_code` for the numbers, is `evidence` compatible with `claim`?", "criteria": CRIT}})
    return {**c, "raw": r["answers"]["raw"], "code_first": r["answers"]["code_first"]}
import concurrent.futures as cf
with cf.ThreadPoolExecutor(4) as ex:
    rows = list(ex.map(one, cases))
def score(key):
    return {"accuracy": round(sum(r[key]["choice"] == r["label"] for r in rows) / len(rows), 3),
            "mean_confidence_when_wrong": round(sum(r[key]["confidence"] for r in rows if r[key]["choice"] != r["label"]) / max(1, sum(r[key]["choice"] != r["label"] for r in rows)), 3),
            "wrong": [{"claim": r["claim"], "value": r["value"], "label": r["label"], "got": r[key]["choice"], "conf": r[key]["confidence"]} for r in rows if r[key]["choice"] != r["label"]]}
res = {"n": len(rows), "raw": score("raw"), "code_first": score("code_first")}
# Deterministic code baseline — what the app would do with no model at all.
def rule(c):
    v, f, cl = c["value"], c["claim_figure"], c["claim"]
    if "more than half" in cl: return "supported" if v > 50 else "contradicted"
    if "at least" in cl: return "supported" if v >= f else "contradicted"
    return "supported" if abs(v - f) <= 3 else "contradicted"
res["pure_code_rule_accuracy"] = round(sum(rule(c) == c["label"] for c in cases) / len(cases), 3)
json.dump(res, open(sys.argv[2], "w"), indent=2)
print(json.dumps({k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk != "wrong"}) for k, v in res.items()}, indent=2))
for w in res["raw"]["wrong"]: print("RAW MISS", w)
