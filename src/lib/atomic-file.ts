import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { lock } from 'proper-lockfile'

/** Cross-process lock, including crash recovery. All writers use these options. */
export async function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const release = await lock(filePath, {
    realpath: false,
    stale: 30_000,
    update: 10_000,
    retries: { retries: 100, minTimeout: 20, maxTimeout: 200, factor: 1.2, randomize: true },
  })
  try {
    return await operation()
  } finally {
    await release()
  }
}

/** Readers see either the old complete document or the new complete document. */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, filePath)
  } finally {
    await fs.unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

export async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}
