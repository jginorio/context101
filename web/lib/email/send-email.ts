import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

type SendEmailInput = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

let sesClient: SESv2Client | undefined;
let warnedMissingFrom = false;

function getSesClient() {
  sesClient ??= new SESv2Client({
    region: process.env.AWS_REGION ?? process.env.SES_REGION ?? "us-east-1",
  });
  return sesClient;
}

export async function sendEmail(input: SendEmailInput) {
  const from = process.env.SES_FROM_EMAIL;
  if (!from) {
    if (!warnedMissingFrom) {
      warnedMissingFrom = true;
      console.warn("[email] SES_FROM_EMAIL is not configured; skipping email sends");
    }
    return;
  }

  const replyTo = process.env.SES_REPLY_TO_EMAIL;

  await getSesClient().send(
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
}
