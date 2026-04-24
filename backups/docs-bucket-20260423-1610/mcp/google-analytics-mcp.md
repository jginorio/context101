# Google Analytics MCP Server

An MCP server that exposes Google Analytics data to LLMs via the [Google Analytics Admin API](https://developers.google.com/analytics/devguides/config/admin/v1) and [Google Analytics Data API](https://developers.google.com/analytics/devguides/reporting/data/v1).

## Tools 🛠️

The server provides the following [MCP Tools](https://modelcontextprotocol.io/docs/concepts/tools) for use with LLMs.

### Account and property information 🟠

- `get_account_summaries`: Retrieves information about the user's Google
  Analytics accounts and properties.
- `get_property_details`: Returns details about a property.
- `list_google_ads_links`: Returns a list of links to Google Ads accounts for
  a property.

### Core reports 📙

- `run_report`: Runs a Google Analytics report using the Data API.
- `get_custom_dimensions_and_metrics`: Retrieves the custom dimensions and
  metrics for a specific property.

### Realtime reports ⏳

- `run_realtime_report`: Runs a Google Analytics realtime report using the
  Data API.

## Setup instructions 🔧

✨ Watch the [Google Analytics MCP Setup Tutorial](https://youtu.be/nS8HLdwmVlY) on YouTube for a step-by-step walkthrough of these instructions.

[![Watch the video](https://img.youtube.com/vi/nS8HLdwmVlY/mqdefault.jpg)](https://www.youtube.com/watch?v=nS8HLdwmVlY)

Setup involves the following steps:

1. Configure Python.
2. Enable APIs in your Google Cloud project.
3. Configure credentials for Google Analytics.
4. Configure the MCP server.

### 1. Configure Python 🐍

[Install pipx](https://pipx.pypa.io/stable/#install-pipx).

### 2. Enable APIs in your project ✅

[Follow the instructions](https://support.google.com/googleapi/answer/6158841)
to enable the following APIs in your Google Cloud project:

- [Google Analytics Admin API](https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com)
- [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com)

### 3. Configure credentials 🔑

Configure your [Application Default Credentials (ADC)](https://cloud.google.com/docs/authentication/provide-credentials-adc). Make sure the credentials are for a user with access to your Google Analytics accounts or properties.

Credentials must include the Google Analytics read-only scope:

```
https://www.googleapis.com/auth/analytics.readonly
```

See [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257) for how to create an OAuth client.

#### Sample `gcloud` commands

- Set up ADC using user credentials and an OAuth desktop or web client, after
  downloading the client JSON to `YOUR_CLIENT_JSON_FILE`:

  ```shell
  gcloud auth application-default login \
    --scopes https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform \
    --client-id-file=YOUR_CLIENT_JSON_FILE
  ```

- Set up ADC using service account impersonation. **This is the recommended approach — the other option will sign out every hour.**

  ```shell
  gcloud auth application-default login \
    --impersonate-service-account=SERVICE_ACCOUNT_EMAIL \
    --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform
  ```

When the `gcloud auth application-default` command completes, copy the
`PATH_TO_CREDENTIALS_JSON` file location printed to the console in the
following message. You'll need this for the next step:

```
Credentials saved to file: [PATH_TO_CREDENTIALS_JSON]
```

### 4. Configure the MCP server

Replace `PATH_TO_CREDENTIALS_JSON` with the path you copied in the previous step.

It is also recommended to add a `GOOGLE_CLOUD_PROJECT` attribute to the `env` object. Replace `YOUR_PROJECT_ID` in the following example with the [project ID](https://support.google.com/googleapi/answer/7014113) of your Google Cloud project.

```json
{
  "mcpServers": {
    "analytics-mcp": {
      "command": "pipx",
      "args": [
        "run",
        "analytics-mcp"
      ],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "PATH_TO_CREDENTIALS_JSON",
        "GOOGLE_PROJECT_ID": "YOUR_PROJECT_ID"
      }
    }
  }
}
```

## Try it out 🥼

Sample prompts to get started:

- Ask what the server can do:

  ```
  what can the analytics-mcp server do?
  ```

- Ask about a Google Analytics property:

  ```
  Give me details about my Google Analytics property with 'xyz' in the name
  ```

- Prompt for analysis:

  ```
  what are the most popular events in my Google Analytics property in the last 180 days?
  ```

- Ask about signed-in users:

  ```
  were most of my users in the last 6 months logged in?
  ```

- Ask about property configuration:

  ```
  what are the custom dimensions and custom metrics in my property?
  ```
