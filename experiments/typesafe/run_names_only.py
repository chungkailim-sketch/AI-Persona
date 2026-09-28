"""E3b: sensitive-field detection from the field NAME only (no cell values leave the app)."""
import json, sys
from run import ask, pmap
from cases import E3_FIELDS
SENS = {"NONE": "Not personal data about a special category, and cannot identify a person: demographics bands, attitudes, behaviours, product answers, pseudonymous ids.",
        "PII": "Could identify a specific person: names, emails, phone numbers, national id numbers, exact postcodes, or free text that contains such details.",
        "SPECIAL_CATEGORY": "Reveals health, religion or belief, ethnicity, political opinion, trade-union membership or sexual orientation — including free text that could."}
def run(f):
    name, _vals, label = f
    r = ask({"field_name": name}, {"cls": {"type": "choice", "instructions": "Classify this survey column for data protection from its name alone. If the name suggests free text (comments, other-specify, notes), assume it could contain anything.", "criteria": SENS}})
    a = r["answers"]["cls"]; return {"field": name, "label": label, "choice": a["choice"], "confidence": round(a["confidence"], 3), "latency_ms": r["_latency_ms"]}
rows = pmap(run, E3_FIELDS)
out = {"accuracy": round(sum(r["choice"] == r["label"] for r in rows) / len(rows), 3), "n": len(rows),
       "misses": [r for r in rows if r["choice"] != r["label"]], "cases": rows}
json.dump(out, open(sys.argv[1], "w"), indent=2)
print(json.dumps({k: v for k, v in out.items() if k != "cases"}, indent=1))
