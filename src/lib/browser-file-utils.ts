export function base64ToBlob(base64: string, mimeType: string): Blob {
  const cleanBase64 = base64.replace(/\s+/g, '')
  const raw = atob(cleanBase64)
  const bytes = new Uint8Array(raw.length)

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image preview'))
    image.src = src
  })
}

export async function createThumbnailBlob(
  base64: string,
  mimeType: string,
  maxWidth: number,
  maxHeight: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const originalBlob = base64ToBlob(base64, mimeType)
  const originalUrl = URL.createObjectURL(originalBlob)

  try {
    const image = await loadImageElement(originalUrl)
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas context unavailable')
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.92))
    if (!blob) throw new Error('Failed to create thumbnail blob')
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(originalUrl)
  }
}
