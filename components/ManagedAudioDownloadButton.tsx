"use client";

import type { ReactNode } from "react";
import { AudioDownloadButton } from "@/components/AudioDownloadButton";
import { useArticleAudioExports } from "@/components/ArticleAudioExportProvider";

type ManagedAudioDownloadButtonProps = {
  href: string;
  title: string;
  label: string;
  ariaLabel: string;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
};

export const ManagedAudioDownloadButton = ({
  href,
  title,
  label,
  ariaLabel,
  className,
  iconClassName,
  children,
}: ManagedAudioDownloadButtonProps) => {
  const { registerDirectDownload } = useArticleAudioExports();

  return (
    <AudioDownloadButton
      href={href}
      label={label}
      ariaLabel={ariaLabel}
      className={className}
      iconClassName={iconClassName}
      onClick={() => {
        registerDirectDownload({ title, href });
      }}
    >
      {children}
    </AudioDownloadButton>
  );
};
