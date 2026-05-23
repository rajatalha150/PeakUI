"use client";

import React from 'react';
import { base64ToBlob, createThumbnailBlob } from '@/lib/browser-file-utils';
import { recordRenderMetric } from '@/lib/render-metrics';

interface ObjectUrlImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  base64Data?: string;
  mimeType?: string;
  src?: string;
  maxPreviewWidth?: number;
  maxPreviewHeight?: number;
  decodeFullSize?: boolean;
}

export function useObjectUrl(
  base64Data?: string,
  mimeType?: string,
  options?: {
    maxPreviewWidth?: number;
    maxPreviewHeight?: number;
    decodeFullSize?: boolean;
  }
) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!base64Data || !mimeType) {
      setObjectUrl(null);
      return;
    }

    let revoked = false;
    let nextUrl: string | null = null;

    const start = performance.now();
    const load = async () => {
      try {
        if (!options?.decodeFullSize && options?.maxPreviewWidth && options?.maxPreviewHeight && mimeType.startsWith('image/')) {
          const thumbnail = await createThumbnailBlob(base64Data, mimeType, options.maxPreviewWidth, options.maxPreviewHeight);
          if (revoked) return;
          nextUrl = URL.createObjectURL(thumbnail.blob);
          setObjectUrl(nextUrl);
          recordRenderMetric('image-decode:thumbnail', performance.now() - start, {
            width: thumbnail.width,
            height: thumbnail.height,
            mimeType,
          });
          return;
        }

        nextUrl = URL.createObjectURL(base64ToBlob(base64Data, mimeType));
        if (revoked) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        setObjectUrl(nextUrl);
        recordRenderMetric('image-decode:full', performance.now() - start, { mimeType });
      } catch (error) {
        console.error('[ObjectUrlImage] failed to build preview URL', error);
        nextUrl = URL.createObjectURL(base64ToBlob(base64Data, mimeType));
        if (revoked) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        setObjectUrl(nextUrl);
      }
    };

    void load();

    return () => {
      revoked = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [base64Data, mimeType, options?.decodeFullSize, options?.maxPreviewHeight, options?.maxPreviewWidth]);

  return objectUrl;
}

export default function ObjectUrlImage({
  base64Data,
  mimeType,
  src,
  alt,
  maxPreviewWidth,
  maxPreviewHeight,
  decodeFullSize,
  ...imgProps
}: ObjectUrlImageProps) {
  const objectUrl = useObjectUrl(base64Data, mimeType, {
    maxPreviewWidth,
    maxPreviewHeight,
    decodeFullSize,
  });
  const resolvedSrc = src || objectUrl || '';

  if (!resolvedSrc) return null;

  return <img {...imgProps} src={resolvedSrc} alt={alt} loading="lazy" />;
}
