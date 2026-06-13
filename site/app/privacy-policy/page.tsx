import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for Context101, including data collection, connectors, storage, retention, and contact information.",
  alternates: { canonical: "/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate="Effective date: June 13, 2026 - Last updated: June 13, 2026"
      contactLabel="Questions about this policy? Contact us at"
      currentPage="privacy"
    >
      <p>
        Context101 (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates
        a knowledge base platform that allows teams to centralize information and
        make it accessible to AI agents via MCP (Model Context Protocol). This
        Privacy Policy explains how we collect, use, and protect your information
        when you use our service.
      </p>

      <LegalSection title="1. Information we collect">
        <p>We collect information you provide directly, including:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Account information such as your name and email address when you
            register or are invited to the platform.
          </li>
          <li>
            Knowledge content you add to your brain, including documents, notes,
            and data imported from connected sources such as Notion pages.
          </li>
          <li>
            Usage data such as queries made, sources added, and agent
            interactions.
          </li>
          <li>
            Technical data including IP address, browser type, and device
            information collected automatically when you access the service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="2. How we use your information">
        <p>We use the information we collect to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide, maintain, and improve the Context101 platform.</li>
          <li>
            Sync and index content from connected sources such as Notion to power
            semantic search and AI agent queries.
          </li>
          <li>Communicate with you about your account and service updates.</li>
          <li>Ensure the security and integrity of the platform.</li>
          <li>Comply with legal obligations.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Notion and third-party connectors">
        <p>
          When you connect a Notion workspace or other supported source,
          Context101 accesses the pages you explicitly authorize and syncs their
          content to your knowledge base. We only read content from the pages and
          workspaces you select. We do not access your broader Notion account
          beyond what you grant permission for.
        </p>
        <p>
          Third-party connector access tokens are stored securely and used solely
          to perform the sync you configure. You can revoke connector access at
          any time from within the app.
        </p>
      </LegalSection>

      <LegalSection title="4. Data storage and security">
        <p>
          Your knowledge base data is stored on secure cloud infrastructure. We
          use industry-standard encryption in transit (TLS) and at rest. Access
          to your data is restricted to authorized personnel and automated
          systems that operate the platform.
        </p>
        <p>
          Context101 is currently in closed alpha. During this period, data
          handling is closely supervised and access is limited to invited users
          only.
        </p>
      </LegalSection>

      <LegalSection title="5. Data sharing">
        <p>
          We do not sell your data. We do not share your knowledge base content
          with third parties except:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            With service providers who help us operate the platform, such as
            cloud hosting and embeddings APIs, under confidentiality agreements.
          </li>
          <li>When required by law or to respond to legal process.</li>
          <li>To protect the rights and safety of our users or the public.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. AI agent access">
        <p>
          The core function of Context101 is to make your knowledge base
          accessible to AI agents via MCP. Queries made by AI agents to your
          brain are logged for security and debugging purposes. These logs are
          retained for a limited period and are not used to train external AI
          models.
        </p>
      </LegalSection>

      <LegalSection title="7. Your rights">
        <p>
          You may request access to, correction of, or deletion of your personal
          data at any time by contacting us. You can also delete your knowledge
          base or revoke connector access directly within the app.
        </p>
      </LegalSection>

      <LegalSection title="8. Data retention">
        <p>
          We retain your data for as long as your account is active or as needed
          to provide the service. If you close your account, we will delete your
          data within 30 days, except where we are required to retain it by law.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. We will notify you
          of material changes via email or a notice in the app. Continued use of
          the service after the update constitutes acceptance of the revised
          policy.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}

