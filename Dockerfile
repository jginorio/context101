FROM python:3.12-slim

# AWS Lambda Web Adapter — lets this same image run as a Lambda container
# (Function URL behind CloudFront) with no handler code: the adapter runs as
# a Lambda extension and proxies invocations to the uvicorn server below.
# Outside Lambda (App Runner, local docker) /opt/extensions is never
# executed, so it's inert there and one image serves both compute targets.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
ENV PORT=8787

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
