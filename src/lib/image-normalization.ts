import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getFileExtension, normalizeImageMimeType } from './file-shared';

const execFileAsync = promisify(execFile);
const IMAGE_CONVERSION_TIMEOUT_MS = 30000;
const IMAGE_CONVERSION_MAX_BUFFER = 1024 * 1024 * 4;

function getInputExtension(name: string, mimeType: string): string {
  const extension = getFileExtension(name);
  if (extension) return extension;

  const normalized = normalizeImageMimeType(name, mimeType);
  if (normalized === 'image/heic') return 'heic';
  if (normalized === 'image/heif') return 'heif';
  if (normalized === 'image/tiff') return 'tiff';
  if (normalized === 'image/bmp') return 'bmp';
  if (normalized === 'image/avif') return 'avif';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/gif') return 'gif';
  return 'img';
}

async function convertWithSharp(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(buffer, {
    animated: false,
    limitInputPixels: 80_000_000,
  })
    .rotate()
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function convertWithCommand(command: string, args: string[], outputPath: string): Promise<Buffer> {
  await execFileAsync(command, args, {
    timeout: IMAGE_CONVERSION_TIMEOUT_MS,
    maxBuffer: IMAGE_CONVERSION_MAX_BUFFER,
  });
  return readFile(outputPath);
}

async function convertWithSystemTools(buffer: Buffer, inputName: string, mimeType: string): Promise<Buffer> {
  const extension = getInputExtension(inputName, mimeType);
  const workDir = await mkdtemp(path.join(tmpdir(), 'peakui-image-'));
  const inputPath = path.join(workDir, `input.${extension}`);
  const outputPath = path.join(workDir, 'output.jpg');

  try {
    await writeFile(inputPath, buffer);

    if (extension === 'heic' || extension === 'heif') {
      try {
        return await convertWithCommand('heif-convert', ['-q', '92', inputPath, outputPath], outputPath);
      } catch {
        // Fall through to ImageMagick below; some builds support HEIC there instead.
      }
    }

    try {
      return await convertWithCommand('magick', [inputPath, '-auto-orient', '-strip', '-quality', '92', outputPath], outputPath);
    } catch {
      return await convertWithCommand('convert', [inputPath, '-auto-orient', '-strip', '-quality', '92', outputPath], outputPath);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function convertImageBufferToJpeg(buffer: Buffer, input: {
  name: string;
  mimeType: string;
}): Promise<{
  data: Buffer;
  method: 'sharp' | 'system';
}> {
  try {
    return {
      data: await convertWithSharp(buffer),
      method: 'sharp',
    };
  } catch (sharpError) {
    try {
      return {
        data: await convertWithSystemTools(buffer, input.name, input.mimeType),
        method: 'system',
      };
    } catch (systemError) {
      const sharpMessage = sharpError instanceof Error ? sharpError.message : String(sharpError);
      const systemMessage = systemError instanceof Error ? systemError.message : String(systemError);
      throw new Error(`sharp failed: ${sharpMessage}; system converter failed: ${systemMessage}`);
    }
  }
}
