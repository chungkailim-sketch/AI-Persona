"""
TimesFM forecasting sidecar for Persona Intelligence.

A small HTTP service the app calls through `src/forecast/timesfm.ts`. It exists as a separate
process because the model is PyTorch and ~1.5 GB resident; the web and worker processes stay
Node-only. It is never called unless the forecasting gate (PRD §24.8) allows it.

Licence guard: only TimesFM 2.5 (Apache-2.0 weights) is accepted. TimesFM 3.0 weights are under a
non-commercial licence and the service refuses to load them.

  POST /forecast  {"inputs": [[...], ...], "horizon": 1}
      -> {"model": ..., "point": [[...]], "q10": [[...]], "q90": [[...]], "quantiles": [0.1, 0.9]}
  GET  /health    -> {"ok": true, "model": ..., "licence": "Apache-2.0"}
"""
import json, os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
import timesfm

CHECKPOINT = os.environ.get("TIMESFM_CHECKPOINT", "google/timesfm-2.5-200m-pytorch")
if "3.0" in CHECKPOINT or "timesfm-3" in CHECKPOINT:
    raise SystemExit("TimesFM 3.0 weights are non-commercial; refusing to load. Use google/timesfm-2.5-200m-pytorch.")
MAX_SERIES = int(os.environ.get("TIMESFM_MAX_SERIES", "20000"))
MAX_HORIZON = int(os.environ.get("TIMESFM_MAX_HORIZON", "16"))
TOKEN = os.environ.get("TIMESFM_TOKEN")  # optional shared secret between app and sidecar

torch.set_float32_matmul_precision("high")
_model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(CHECKPOINT)
_model.compile(timesfm.ForecastConfig(
    max_context=1024, max_horizon=MAX_HORIZON, normalize_inputs=True,
    use_continuous_quantile_head=True, force_flip_invariance=True,
    infer_is_positive=True, fix_quantile_crossing=True,
))
_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self):
        return not TOKEN or self.headers.get("Authorization") == f"Bearer {TOKEN}"

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "model": CHECKPOINT, "licence": "Apache-2.0"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/forecast":
            return self._send(404, {"error": "not found"})
        if not self._authorised():
            return self._send(401, {"error": "unauthorised"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            inputs = [np.asarray(x, dtype=np.float32) for x in body["inputs"]]
            horizon = int(body["horizon"])
            if not inputs or len(inputs) > MAX_SERIES or not (1 <= horizon <= MAX_HORIZON):
                return self._send(422, {"error": "inputs or horizon out of range"})
            if any(len(x) < 2 or not np.all(np.isfinite(x)) for x in inputs):
                return self._send(422, {"error": "every series needs at least two finite values"})
            with _lock:
                point, q = _model.forecast(horizon=horizon, inputs=inputs)
            self._send(200, {"model": CHECKPOINT, "point": point[:, :horizon].tolist(),
                             "q10": q[:, :horizon, 1].tolist(), "q90": q[:, :horizon, 9].tolist(), "quantiles": [0.1, 0.9]})
        except Exception as e:  # no stack trace leaves the service
            self._send(400, {"error": type(e).__name__})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
