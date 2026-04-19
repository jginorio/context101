/**
 * Auto-ingest Lambda — triggered on S3 PutObject / DeleteObject.
 * Kicks off a Bedrock KB ingestion job so the new/changed file gets
 * indexed without manual intervention.
 *
 * Multiple uploads in quick succession will each trigger this,
 * but StartIngestionJob is cheap and Bedrock handles queueing.
 */
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";

const bedrock = new BedrockAgentClient({});

export const handler = async (event) => {
  const KB_ID = process.env.KB_ID;
  const DS_ID = process.env.DS_ID;

  if (!KB_ID || !DS_ID) {
    throw new Error("KB_ID and DS_ID env vars are required");
  }

  const keys = (event.Records ?? [])
    .map((r) => r.s3?.object?.key)
    .filter(Boolean);

  console.log(
    `Triggering ingestion for ${keys.length} S3 event(s): ${keys.join(", ")}`
  );

  try {
    const res = await bedrock.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: DS_ID,
        description: `Auto-triggered by S3 events: ${keys.slice(0, 3).join(", ")}`,
      })
    );
    console.log(`Started ingestion job ${res.ingestionJob?.ingestionJobId}`);
    return { statusCode: 200, jobId: res.ingestionJob?.ingestionJobId };
  } catch (err) {
    // A ConflictException means a job is already running — that's fine,
    // it'll pick up the new files too.
    if (err.name === "ConflictException") {
      console.log(
        "Ingestion already in progress; new files will be picked up by the running job."
      );
      return { statusCode: 200, conflict: true };
    }
    console.error("Failed to start ingestion:", err);
    throw err;
  }
};
