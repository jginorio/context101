import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

type SendEmailInput = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

let sesClient: SESv2Client | undefined;
let warnedMissingFrom = false;

function defaultFromEmail() {
  const hosted =
    process.env.APP_MODE === "hosted" ||
    process.env.APP_URL?.includes("context101.dev") ||
    process.env.BETTER_AUTH_URL?.includes("context101.dev");
  if (!hosted) return undefined;
  return "Context101 <no-reply@context101.dev>";
}

function getSesClient() {
  sesClient ??= new SESv2Client({
    region: process.env.AWS_REGION ?? process.env.SES_REGION ?? "us-east-1",
  });
  return sesClient;
}

export async function sendEmail(input: SendEmailInput) {
  const from = process.env.SES_FROM_EMAIL || defaultFromEmail();
  if (!from) {
    if (!warnedMissingFrom) {
      warnedMissingFrom = true;
      console.warn("[email] SES_FROM_EMAIL is not configured; skipping email sends");
    }
    return;
  }

  const replyTo = process.env.SES_REPLY_TO_EMAIL;

  const result = await getSesClient().send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: {
        ToAddresses: [input.to],
      },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
      Content: {
        Simple: {
          Subject: {
            Charset: "UTF-8",
            Data: input.subject,
          },
          Body: {
            Html: {
              Charset: "UTF-8",
              Data: input.html,
            },
            Text: {
              Charset: "UTF-8",
              Data: input.text,
            },
          },
        },
      },
    })
  );
  console.info(`[email] sent "${input.subject}" to ${input.to}: ${result.MessageId}`);
}
