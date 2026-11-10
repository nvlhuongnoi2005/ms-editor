FROM ghcr.io/osgeo/gdal:ubuntu-small-3.11.5

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt
COPY worker.py catalog.py test_archive.py ./
ENTRYPOINT ["python3", "/app/worker.py"]
