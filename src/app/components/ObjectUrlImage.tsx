"use client";

import React from 'react';
import { base64ToBlob } from '@/lib/browser-file-utils';

interface ObjectUrlImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  base64Data?: string;
  mimeType?: string;
  src?: string;
}

export function useObjectUrl(base64Data?: string, mimeType?: string) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!base64Data || !mimeType) {
      setObjectUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(base64ToBlob(base64Data, mimeType));
    setObjectUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [base64Data, mimeType]);

  return objectUrl;
}

export default function ObjectUrlImage({ base64Data, mimeType, src, alt, ...imgProps }: ObjectUrlImageProps) {
  const objectUrl = useObjectUrl(base64Data, mimeType);
  const resolvedSrc = src || objectUrl || '';

  if (!resolvedSrc) return null;

  return <img {...imgProps} src={resolvedSrc} alt={alt} />;
}
