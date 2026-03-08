export const PodcastEpisodeArtwork = ({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) => {
  if (!src) return null;

  return (
    <div className="mb-4 flex justify-center">
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-2 w-full max-w-[220px] aspect-square">
      {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="block w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    </div>
  );
};
