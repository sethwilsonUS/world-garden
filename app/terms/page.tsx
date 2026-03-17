import type { Metadata } from "next";
import { LegalPageLayout, LegalSection } from "@/components/LegalPageLayout";

const LAST_UPDATED = "March 16, 2026";

export const metadata: Metadata = {
  title: "Terms of Use — Curio Garden",
  description:
    "The basic terms for using Curio Garden, including accounts, content sources, acceptable use, and availability.",
};

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Use"
      description="These terms describe the basic rules for using Curio Garden. By using the service, you agree to these terms."
      lastUpdated={LAST_UPDATED}
    >
      <LegalSection id="terms-service" title="Using the service">
        <p>
          Curio Garden is provided as an informational and educational service
          for exploring and listening to article-based content. You agree to use
          the service lawfully and in a way that does not interfere with other
          people&rsquo;s use of it.
        </p>
        <p>
          Some features may change, move, or disappear over time. Curio Garden
          may update how search, bookmarks, audio, or account features work as
          the product evolves.
        </p>
      </LegalSection>

      <LegalSection id="terms-accounts" title="Accounts and sign-in">
        <p>
          Some features may be available without an account, while others may
          require you to sign in. If account features are enabled, authentication
          may be provided through Clerk and social sign-in providers such as
          Google.
        </p>
        <p>
          You are responsible for using your account lawfully and for keeping
          access to your sign-in methods under your control.
        </p>
      </LegalSection>

      <LegalSection id="terms-content" title="Content, licenses, and attribution">
        <p>
          Curio Garden uses content from Wikipedia. That content remains subject
          to Wikipedia&rsquo;s own licenses, terms, and attribution requirements,
          including CC BY-SA where applicable.
        </p>
        <p>
          Wikipedia and related names are trademarks of the Wikimedia Foundation.
          Any third-party trademarks, logos, or brand names mentioned by the
          service remain the property of their respective owners.
        </p>
      </LegalSection>

      <LegalSection id="terms-acceptable-use" title="Acceptable use">
        <ul className="list-disc pl-5 space-y-2">
          <li>Do not use the service for unlawful, abusive, or fraudulent activity.</li>
          <li>Do not try to break, overload, scrape, or bypass protections on the service.</li>
          <li>Do not interfere with other users, hosting infrastructure, or connected services.</li>
          <li>Do not misuse exported audio, generated summaries, or cached content in a way that violates applicable rights or licenses.</li>
        </ul>
      </LegalSection>

      <LegalSection id="terms-disclaimers" title="Disclaimers">
        <p>
          Curio Garden may include generated summaries, synthesized audio, or
          other transformed content. Those features can be imperfect and should
          not be treated as professional, legal, medical, financial, or safety
          advice.
        </p>
        <p>
          The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo;
          basis to the extent permitted by applicable law. Curio Garden does not
          guarantee uninterrupted availability, complete accuracy, or permanent
          preservation of any data or feature.
        </p>
      </LegalSection>

      <LegalSection id="terms-liability" title="Limits and changes">
        <p>
          To the extent permitted by law, Curio Garden is not liable for losses
          resulting from downtime, content inaccuracies, third-party service
          outages, or changes to the service.
        </p>
        <p>
          Curio Garden may revise these Terms of Use from time to time. If the
          terms change, the updated version will be posted here with a revised
          date.
        </p>
        <p>
          Questions about a specific Curio Garden deployment should be sent
          through the contact or support method published with that deployment.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
