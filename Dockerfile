# Stage 1: Build the frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and assemble
FROM python:3.10-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY --from=frontend-builder /app/dist/ frontend/dist/

EXPOSE 8338

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8338"]
