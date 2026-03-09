export const PodcastEpisodeArtwork = ({
  src,
  alt,
  className = "",
}: {
  src: string | null;
  alt: string;
  className?: string;
}) => {
  if (!src) return null;

  return (
    <div
      className={`aspect-square overflow-hidden rounded-xl border border-border bg-surface-2 ${className}`.trim()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="block h-full w-full object-cover"
        loading="lazy"
      />
    </div>
  );
};
