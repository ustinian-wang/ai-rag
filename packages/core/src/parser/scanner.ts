import fs from 'fs/promises'
import path from 'path'

const SUPPORTED_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.json', '.md']
const IGNORE_DIRS = ['node_modules', 'dist', 'build', '.git', '.next', 'coverage']

export interface ScannedFile {
  path: string
  relativePath: string
  extension: string
  size: number
}

export async function scanDirectory(rootPath: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []

  async function scan(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) {
          await scan(fullPath)
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name)
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          const stats = await fs.stat(fullPath)
          files.push({
            path: fullPath,
            relativePath: path.relative(rootPath, fullPath),
            extension: ext,
            size: stats.size,
          })
        }
      }
    }
  }

  await scan(rootPath)
  return files
}
