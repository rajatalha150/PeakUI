export function attachmentPrompt(text: string, files: Array<{ name: string; path: string }>): string {
  const paths = files.map(file => `- ${JSON.stringify(file.name)}: ${JSON.stringify(file.path)}`).join('\n')
  return `${text.trim() || 'Inspect the attached files and help with this project.'}\n\nAttached files in the current workspace:\n${paths}`
}

export async function imagePromptPart(file: File): Promise<{ type: 'image'; data: string; mimeType: 'image/jpeg' }> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image conversion is unavailable in this browser.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { type: 'image', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mimeType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}
