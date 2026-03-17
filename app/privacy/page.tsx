import type { Metadata } from "next";
import { LegalPageLayout, LegalSection } from "@/components/LegalPageLayout";

const LAST_UPDATED = "March 16, 2026";

export const metadata: Metadata = {
  title: "Privacy Policy — Curio Garden",
  description:
    "How Curio Garden handles account data, bookmarks, browser storage, analytics, and third-party services.",
};

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      description="This page explains what information Curio Garden handles, where some of that information is stored, and the third-party services involved when you browse, save bookmarks, sign in, or listen to audio."
      lastUpdated={LAST_UPDATED}
    >
      <LegalSection id="privacy-overview" title="Overview">
        <p>
          Curio Garden is an informational reading and listening experience built
          around Wikipedia content. You can browse without an account, or you
          can sign in to sync bookmarks across devices.
        </p>
        <p>
          The service is designed to keep some convenience features on your
          device when you are signed out, while storing signed-in bookmarks on
          the service so they can follow your account.
        </p>
      </LegalSection>

      <LegalSection id="privacy-collect" title="Information Curio Garden may handle">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Account information from Clerk, such as a stable account identifier
            and, depending on your sign-in method, profile details like your
            name, email address, or profile image.
          </li>
          <li>
            Signed-in bookmark data, including saved article slugs, titles, and
            timestamps, so bookmarks can sync across devices.
          </li>
          <li>
            Browser-stored data for signed-out use, such as guest bookmarks,
            reading history, listening history, and interface preferences like
            theme and playback settings.
          </li>
          <li>
            Basic technical and analytics data used to operate and improve the
            service, such as performance and diagnostic information from hosting
            and analytics providers.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="privacy-use" title="How this information is used">
        <ul className="list-disc pl-5 space-y-2">
          <li>To sign you in and keep your session working securely.</li>
          <li>To sync signed-in bookmarks across devices.</li>
          <li>To remember signed-out preferences and local convenience data.</li>
          <li>To deliver audio features, improve reliability, and understand service performance.</li>
          <li>To prevent abuse, protect the service, and troubleshoot issues.</li>
        </ul>
      </LegalSection>

      <LegalSection
        id="privacy-device-storage"
        title="What stays on your device"
      >
        <p>
          When you use Curio Garden while signed out, some data may be stored in
          your browser using local storage so the app can remember things like
          bookmarks, reading history, listening history, and theme preference.
        </p>
        <p>
          When you later sign in, guest bookmarks on that device may be imported
          into your account once so they can sync. Local history and similar
          convenience data remain device-local in this version of the app.
        </p>
      </LegalSection>

      <LegalSection id="privacy-third-parties" title="Third-party services">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Clerk is used for authentication and account sessions, including
            social sign-in providers such as Google if enabled.
          </li>
          <li>
            Convex is used for application data needed to power signed-in
            features such as synced bookmarks.
          </li>
          <li>
            Hosting and analytics providers may process limited technical data
            to run the site and measure performance.
          </li>
          <li>
            Wikipedia content is displayed under its own licenses and policies.
          </li>
          <li>
            Audio generation may rely on third-party text-to-speech tooling and
            infrastructure when audio features are used.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="privacy-choices" title="Your choices">
        <ul className="list-disc pl-5 space-y-2">
          <li>You can browse Curio Garden without creating an account.</li>
          <li>
            You can clear browser storage through your browser settings if you
            want to remove device-local guest data.
          </li>
          <li>
            If you sign in, you can remove saved bookmarks from your account in
            the app.
          </li>
          <li>
            If you use Google sign-in, you can also manage that connection from
            your Google account permissions.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="privacy-changes" title="Changes to this policy">
        <p>
          Curio Garden may update this Privacy Policy from time to time as the
          service changes. Material updates will be reflected by updating the
          date at the top of this page.
        </p>
        <p>
          Questions about the privacy practices of a specific Curio Garden
          deployment should be sent through the contact or support method
          published with that deployment.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
