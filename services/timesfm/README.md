# TimesFM sidecar

Optional. The app works without it: the forecasting gate uses classical baselines computed in
code, and refuses forecasts the data cannot support.

- Model: `google/timesfm-2.5-200m-pytorch` (200M parameters, Apache-2.0 weights). TimesFM 3.0 is
  refused at start-up: its weights are non-commercial.
- Resources: ~1.5 GB RAM on CPU; ~800 MB of weights downloaded on first start.
- App configuration: `TIMESFM_URL=http://timesfm:8765`, optional `TIMESFM_TOKEN` (shared secret),
  and `TIMESFM_APPROVED=true` only once legal and technical approval is recorded (PRD §24.8 Q8–9).
  Without approval the app may use the service for backtest evaluation, never for a shown forecast.

```bash
python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
python server.py   # :8765
```
