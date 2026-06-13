import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms of Use for Context101, including access, acceptable use, content, connectors, MCP agent access, and alpha program terms.",
  alternates: { canonical: "/terms-of-use" },
};

export default function TermsOfUsePage() {
  return (
    <LegalDocument
      title="Terms of Use"
      effectiveDate="Effective date: June 13, 2026 - Last updated: June 13, 2026"
      contactLabel="Questions about these terms? Contact us at"
      currentPage="terms"
    >
      <p>
        These Terms of Use (&quot;Terms&quot;) govern your access to and use of
        Context101 (&quot;the Service&quot;), operated by Jaime Ginorio / Red
        Ventures (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). By accessing
        or using Context101, you agree to be bound by these Terms.
      </p>

      <LegalSection title="1. Access and eligibility">
        <p>
          Context101 is currently in closed alpha and is available by invitation
          only. Access is granted at our sole discretion. You must be at least 18
          years old and authorized to use the Service on behalf of yourself or
          the organization you represent.
        </p>
      </LegalSection>

      <LegalSection title="2. Use of the service">
        <p>
          You agree to use Context101 only for lawful purposes and in accordance
          with these Terms. You must not:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Use the Service to store or distribute content that is illegal,
            harmful, or infringes third-party rights.
          </li>
          <li>
            Attempt to gain unauthorized access to any part of the Service or its
            underlying infrastructure.
          </li>
          <li>
            Reverse-engineer, decompile, or attempt to extract the source code of
            the platform.
          </li>
          <li>
            Use the Service in a way that could damage, disable, or overburden
            its infrastructure.
          </li>
          <li>
            Share your access credentials with others or allow unauthorized users
            to access your account.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Your content">
        <p>
          You retain ownership of all content you add to your Context101
          knowledge base (&quot;Your Content&quot;). By adding content, you grant
          us a limited license to store, index, and serve that content to
          authorized AI agents operating on your behalf, solely to provide the
          Service.
        </p>
        <p>
          You are responsible for ensuring you have the rights to add any content
          to Context101, including content imported from third-party sources such
          as Notion.
        </p>
      </LegalSection>

      <LegalSection title="4. Third-party connectors">
        <p>
          The Service integrates with third-party platforms such as Notion to
          sync content into your knowledge base. Your use of those platforms is
          governed by their own terms of service. We are not responsible for the
          availability or behavior of third-party services.
        </p>
      </LegalSection>

      <LegalSection title="5. AI agent access via MCP">
        <p>
          Context101 is designed to make your knowledge base accessible to AI
          agents via the Model Context Protocol (MCP). You are responsible for
          configuring which agents have access to your brain and for any actions
          those agents take using knowledge retrieved from your Context101
          instance.
        </p>
      </LegalSection>

      <LegalSection title="6. Alpha program">
        <p>
          The Service is provided in an early-access, closed alpha state.
          Features may change, be removed, or become unavailable without notice.
          We make no guarantees about uptime, data durability, or feature
          stability during this period. Your feedback is welcomed and may be used
          to improve the product.
        </p>
      </LegalSection>

      <LegalSection title="7. Intellectual property">
        <p>
          All rights in the Context101 platform, including its design, code, and
          branding, are owned by us or our licensors. Nothing in these Terms
          grants you any rights to use our trademarks, logos, or other
          intellectual property without our prior written consent.
        </p>
      </LegalSection>

      <LegalSection title="8. Disclaimers">
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available&quot;
          without warranties of any kind, express or implied. We do not warrant
          that the Service will be uninterrupted, error-free, or free of harmful
          components.
        </p>
      </LegalSection>

      <LegalSection title="9. Limitation of liability">
        <p>
          To the fullest extent permitted by applicable law, we shall not be
          liable for any indirect, incidental, special, consequential, or punitive
          damages arising from your use of or inability to use the Service, even
          if we have been advised of the possibility of such damages.
        </p>
      </LegalSection>

      <LegalSection title="10. Termination">
        <p>
          We reserve the right to suspend or terminate your access to the Service
          at any time, with or without notice, if we believe you have violated
          these Terms or for any other reason at our discretion. You may stop
          using the Service at any time.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to these terms">
        <p>
          We may update these Terms from time to time. We will notify you of
          material changes via email or a notice in the app. Continued use of the
          Service after any changes constitutes your acceptance of the revised
          Terms.
        </p>
      </LegalSection>

      <LegalSection title="12. Governing law">
        <p>
          These Terms are governed by the laws of the Commonwealth of Puerto Rico
          and the United States, without regard to conflict of law principles.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}

