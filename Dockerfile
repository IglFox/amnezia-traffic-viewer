FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/

EXPOSE 8338

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8338"]
