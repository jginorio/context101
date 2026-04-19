FROM python:3.12-slim

WORKDIR /app

# System deps kept minimal; fastmcp + boto3 are pure Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8787

# 0.0.0.0 so App Runner / any external caller can reach it
CMD ["fastmcp", "run", "server.py:mcp", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8787"]
