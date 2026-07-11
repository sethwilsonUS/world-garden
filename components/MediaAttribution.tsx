import type { WikimediaMediaAttribution } from "@/lib/wikimedia-media";

export const MediaAttribution = ({
  attribution,
  compact = false,
  inverse = false,
}: {
  attribution?: WikimediaMediaAttribution;
  compact?: boolean;
  inverse?: boolean;
}) => {
  if (!attribution?.sourceUrl) return null;

  const rawCreator = attribution.creator || attribution.credit;
  const creator = rawCreator && !/^https?:\/\//i.test(rawCreator)
    ? rawCreator
    : undefined;
  const credit = attribution.credit && !/^https?:\/\//i.test(attribution.credit)
    ? attribution.credit
    : undefined;
  const textClass = inverse ? "text-white/75" : "text-muted";
  const linkClass = inverse
    ? "text-white underline decoration-white/50"
    : "text-accent underline decoration-accent/50";

  if (compact) {
    return (
      <p className={`line-clamp-2 break-words text-[0.6875rem] leading-relaxed ${textClass}`}>
        Image{creator ? ` by ${creator}` : " source"}
        {attribution.licenseName ? ` · ${attribution.licenseName}` : ""}
        {" · "}
        <a
          href={attribution.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          source
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </p>
    );
  }

  return (
    <dl className={`grid gap-1 break-words text-xs leading-relaxed ${textClass}`}>
      {creator ? (
        <div>
          <dt className="inline font-semibold">Creator: </dt>
          <dd className="inline">{creator}</dd>
        </div>
      ) : null}
      {credit && credit !== creator ? (
        <div>
          <dt className="inline font-semibold">Credit: </dt>
          <dd className="inline">{credit}</dd>
        </div>
      ) : null}
      {attribution.licenseName ? (
        <div>
          <dt className="inline font-semibold">License: </dt>
          <dd className="inline">
            {attribution.licenseUrl ? (
              <a
                href={attribution.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                {attribution.licenseName}
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            ) : (
              attribution.licenseName
            )}
          </dd>
        </div>
      ) : null}
      <div>
        <dt className="inline font-semibold">Source: </dt>
        <dd className="inline">
          <a
            href={attribution.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {attribution.sourceTitle || "Wikimedia file page"}
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        </dd>
      </div>
    </dl>
  );
};
