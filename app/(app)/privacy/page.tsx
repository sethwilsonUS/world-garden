import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageLayout, LegalSection } from "@/components/LegalPageLayout";

const LAST_UPDATED = "July 27, 2026";

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
          Curio Garden is an informational reading and listening experience
          built around Wikipedia content. You can browse without an account, or
          you can sign in to sync bookmarks, build a listening playlist, and
          save listening progress across devices.
        </p>
        <p>
          The service is designed to keep some convenience features on your
          device when you are signed out, while storing signed-in bookmarks on
          the service so they can follow your account. The sections below name
          the other signed-in information Curio Garden stores.
        </p>
      </LegalSection>

      <LegalSection
        id="privacy-collect"
        title="Information Curio Garden may handle"
      >
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
            Personal Playlist data, including playlist order, episode-generation
            status, generated episode files, and private RSS feed token.
          </li>
          <li>
            Signed-in article listening progress, including heard ranges and
            qualification timestamps, along with topic-badge credit earned from
            qualifying listening.
          </li>
          <li>
            Signed-in article-audio export records and generated files, plus
            account-linked generation quota windows used to limit repeated or
            unusually heavy audio-generation requests.
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
          <li>
            Information you choose to submit through the feedback form. This may
            include a feedback message, optional details about your browser,
            device, assistive technology, or other environment, an optional
            contact email, and whether you opt in to invitations for future
            research. When you choose “Give feedback on this article,” the
            article title, article identifier, and saved Wikipedia revision are
            also included so the feedback can be connected to the page you were
            using.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="privacy-use" title="How this information is used">
        <ul className="list-disc pl-5 space-y-2">
          <li>To sign you in and keep your session working securely.</li>
          <li>To sync signed-in bookmarks across devices.</li>
          <li>
            To remember signed-out preferences and local convenience data.
          </li>
          <li>
            To deliver audio features, improve reliability, and understand
            service performance.
          </li>
          <li>
            To prevent abuse, protect the service, and troubleshoot issues.
          </li>
          <li>
            To understand feedback and access barriers, improve the product, and
            contact you about your feedback or future research only when you
            choose to provide an email address for that purpose.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="privacy-feedback" title="Feedback and research">
        <p>
          The feedback form is available without signing in. A message is
          required when you submit feedback. Environment details and a contact
          email are optional unless you opt in to research invitations, in which
          case an email address is needed so an invitation can reach you. You do
          not need to share a medical condition or diagnosis to describe an
          access need, report a barrier, or suggest an improvement.
        </p>
        <p>
          Feedback is used to understand what is working, identify barriers, and
          decide what to improve. If you provide an email address, it may be
          used to follow up about your feedback. Curio Garden will use it for
          research invitations only if you opt in. Feedback is not automatically
          joined to your signed-in account. Curio Garden removes the contact
          email from stored feedback when it reaches 180 days and turns off the
          related research opt-in. An hourly cleanup works in bounded batches
          and immediately schedules additional batches until any backlog is
          drained. The feedback message and any environment details remain so
          the team can continue to understand product issues and access
          barriers. Article context also remains with article-specific feedback.
          You can share feedback on the{" "}
          <Link
            href="/feedback"
            className="text-accent underline underline-offset-2"
          >
            feedback page
          </Link>
          .
        </p>
        <p>
          To limit repeated submissions, the server derives an opaque,
          secret-salted identifier from the request&apos;s network address.
          Curio Garden does not store the raw network address with your
          feedback. The separate quota record&apos;s active window ends after
          one hour. An hourly cleanup deletes expired quota records in bounded
          batches of up to 500 until the current backlog is gone.
        </p>
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
          Device-local information is outside Curio Garden’s server-side account
          data.
        </p>
      </LegalSection>

      <LegalSection id="privacy-third-parties" title="Third-party services">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Clerk is used for authentication and account sessions, including
            social sign-in providers such as Google if enabled.
          </li>
          <li>
            Convex stores application data used for signed-in features such as
            synced bookmarks, playlist episodes and audio, private feed access,
            listening progress, badge credit, and article-audio exports. It also
            stores anonymous feedback, any contact or research details you
            choose to provide, article context attached to feedback, and opaque
            submission-quota records.
          </li>
          <li>
            Hosting and analytics providers may process limited technical data
            to run the site and measure performance.
          </li>
          <li>
            Wikipedia content is displayed under its own licenses and policies.
          </li>
          <li>
            Audio generation may use Microsoft Edge TTS or OpenAI synthetic
            speech services. OpenAI speech is reserved for signed-in listening
            and trusted personal audio generation.
          </li>
        </ul>
        <p>
          Shared article and audio caches and aggregated analytics are not
          treated as account-owned data. They may remain when an individual
          account record is removed because they support the public service and
          do not represent that account’s private playlist or listening history.
        </p>
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
            A private RSS URL is a revocable bearer credential: anyone who has
            the address can use it. From the dashboard, you can replace the
            address or turn the feed off without deleting your playlist.
            Replacing or turning off the feed stops future access through Curio
            Garden’s feed and media routes. Previously downloaded, cached, or
            directly accessed copies cannot be recalled.
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
          Questions about Curio Garden&apos;s privacy practices can be sent
          through the{" "}
          <Link
            href="/feedback"
            className="text-accent underline underline-offset-2"
          >
            feedback page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
