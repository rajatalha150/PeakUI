export function base64ToBlob(base64: string, mimeType: string): Blob {
  const cleanBase64 = base64.replace(/\s+/g, '')
  const raw = atob(cleanBase64)
  const bytes = new Uint8Array(raw.length)

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}
