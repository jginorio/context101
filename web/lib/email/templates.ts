import { deploymentConfig } from "@/lib/deployment/config";

const APP_NAME = "Context101";

type EmailContent = {
  html: string;
  subject: string;
  text: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function baseUrl() {
  return deploymentConfig.appUrl.replace(/\/$/, "");
}

function layout({
  body,
  preview,
  title,
}: {
  body: string;
  preview: string;
  title: string;
}) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#faf5fc;color:#211822;font-family:Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preview)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf5fc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #eaddec;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 18px;">
                <p style="margin:0;color:#8b3f9d;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${APP_NAME}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                ${body}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#7b6a7d;font-size:12px;">This email was sent by ${APP_NAME}.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(label: string, href: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#8b3f9d;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">${escapeHtml(label)}</a>`;
}

function paragraph(value: string) {
  return `<p style="margin:0 0 16px;color:#3b303d;font-size:15px;line-height:1.6;">${escapeHtml(value)}</p>`;
}

export function welcomeEmail({
  name,
}: {
  name?: string | null;
}): EmailContent {
  const appLink = `${baseUrl()}/knowledge`;
  const displayName = name?.trim() || "there";
  const subject = `Welcome to ${APP_NAME}`;

  return {
    subject,
    html: layout({
      title: subject,
      preview: `Your ${APP_NAME} workspace is ready.`,
      body: `
        <h1 style="margin:0 0 16px;color:#211822;font-size:24px;line-height:1.25;">Welcome, ${escapeHtml(displayName)}.</h1>
        ${paragraph(`Your ${APP_NAME} account is ready. You can start adding knowledge, connecting sources, and inviting your team.`)}
        <p style="margin:24px 0;">${button("Open Context101", appLink)}</p>
        ${paragraph(`If you did not create this account, you can ignore this email.`)}
      `,
    }),
    text: [
      `Welcome, ${displayName}.`,
      "",
      `Your ${APP_NAME} account is ready. You can start adding knowledge, connecting sources, and inviting your team.`,
      "",
      `Open ${APP_NAME}: ${appLink}`,
      "",
      "If you did not create this account, you can ignore this email.",
    ].join("\n"),
  };
}

export function resetPasswordEmail({
  resetUrl,
}: {
  resetUrl: string;
}): EmailContent {
  const subject = `Reset your ${APP_NAME} password`;

  return {
    subject,
    html: layout({
      title: subject,
      preview: `Use this link to reset your ${APP_NAME} password.`,
      body: `
        <h1 style="margin:0 0 16px;color:#211822;font-size:24px;line-height:1.25;">Reset your password</h1>
        ${paragraph("We received a request to reset your password. Use the link below to choose a new one.")}
        <p style="margin:24px 0;">${button("Reset password", resetUrl)}</p>
        ${paragraph("If you did not request this, you can ignore this email.")}
      `,
    }),
    text: [
      "Reset your password",
      "",
      "We received a request to reset your password. Use the link below to choose a new one.",
      "",
      resetUrl,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
  };
}

export function organizationInvitationEmail({
  inviteLink,
  invitedByEmail,
  invitedByName,
  organizationName,
  role,
}: {
  inviteLink: string;
  invitedByEmail?: string | null;
  invitedByName?: string | null;
  organizationName?: string | null;
  role?: string | null;
}): EmailContent {
  const orgName = organizationName?.trim() || "a workspace";
  const inviter = invitedByName?.trim() || invitedByEmail?.trim() || "A teammate";
  const subject = `You have been invited to ${orgName} on ${APP_NAME}`;
  const roleText = role ? ` as ${role}` : "";

  return {
    subject,
    html: layout({
      title: subject,
      preview: `${inviter} invited you to join ${orgName}.`,
      body: `
        <h1 style="margin:0 0 16px;color:#211822;font-size:24px;line-height:1.25;">Join ${escapeHtml(orgName)}</h1>
        ${paragraph(`${inviter} invited you to join ${orgName}${roleText} on ${APP_NAME}.`)}
        <p style="margin:24px 0;">${button("Accept invitation", inviteLink)}</p>
        ${paragraph("This invitation link is unique to your email address.")}
      `,
    }),
    text: [
      `Join ${orgName}`,
      "",
      `${inviter} invited you to join ${orgName}${roleText} on ${APP_NAME}.`,
      "",
      `Accept invitation: ${inviteLink}`,
      "",
      "This invitation link is unique to your email address.",
    ].join("\n"),
  };
}
