import { sendEmail } from "@/lib/email/send-email";
import {
  organizationInvitationEmail,
  resetPasswordEmail,
  welcomeEmail,
} from "@/lib/email/templates";

async function deliver(
  to: string,
  content: { html: string; subject: string; text: string }
) {
  try {
    await sendEmail({ to, ...content });
  } catch (error) {
    console.error(
      `[email] failed to send "${content.subject}" to ${to}:`,
      error
    );
  }
}

export function sendWelcomeEmail(input: {
  email: string;
  name?: string | null;
}) {
  return deliver(input.email, welcomeEmail({ name: input.name }));
}

export function sendPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
}) {
  return deliver(input.email, resetPasswordEmail({ resetUrl: input.resetUrl }));
}

export function sendOrganizationInvitationEmail(input: {
  email: string;
  inviteLink: string;
  invitedByEmail?: string | null;
  invitedByName?: string | null;
  organizationName?: string | null;
  role?: string | null;
}) {
  return deliver(input.email, organizationInvitationEmail(input));
}
