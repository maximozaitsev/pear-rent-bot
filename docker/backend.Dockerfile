FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY backend/pyproject.toml /app/pyproject.toml
COPY backend/alembic.ini /app/alembic.ini
COPY backend/migrations /app/migrations
COPY backend/app /app/app
COPY backend/tests /app/tests
RUN pip install --default-timeout=300 --retries 10 --no-cache-dir -e '.[dev]'

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
