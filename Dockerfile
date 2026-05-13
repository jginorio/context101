FROM python:3.12-slim

WORKDIR /app

# System deps kept minimal; fastmcp + boto3 are pure Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8787

# server.py builds a Starlette app (`app`) that wraps FastMCP with
# brain-routing + per-brain token validation. uvicorn runs it directly so
# we control the ASGI surface; `fastmcp run` would bypass our middleware.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8787"]
