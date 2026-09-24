# Forecasting sidecar. Deploy as its own Railway service; the app reaches it via TIMESFM_URL.
# The weights (~800 MB) download on first start into /models; mount a volume there to keep them.
FROM python:3.11-slim
WORKDIR /srv
ENV HF_HOME=/models PORT=8765
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8765/health')"
CMD ["python", "server.py"]
