import fs from 'fs/promises'
import path from 'path'

const SUPPORTED_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.json', '.md']
const IGNORE_DIRS = ['node_modules', 'dist', 'build', '.git', '.next', 'coverage']

// 忽略的文件模式
const IGNORE_PATTERNS = [
  /\.min\.js$/,           // 压缩的 JS 文件
  /\.min\.css$/,          // 压缩的 CSS 文件
  /\.bundle\.js$/,        // 打包文件
  /\.chunk\.js$/,         // 代码分块文件
  /\.vendor\.js$/,        // 第三方库文件
  /swfupload/i,           // swfupload 相关文件
  /vconsole/i,            // vconsole 相关文件
  /zerocliboard/i,        // ZeroClipboard 相关文件
  /zclip/i,               // zclip 相关文件
  /jquery.*\.js$/i,       // jQuery 库文件
  /lodash.*\.js$/i,       // Lodash 库文件
  /moment.*\.js$/i,       // Moment.js 库文件
  /animate.*\.js$/i,      // Animate.js 库文件
]

export interface ScannedFile {
  path: string
  relativePath: string
  extension: string
  size: number
}

function shouldIgnoreFile(filename: string): boolean {
  return IGNORE_PATTERNS.some(pattern => pattern.test(filename))
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
        if (SUPPORTED_EXTENSIONS.includes(ext) && !shouldIgnoreFile(entry.name)) {
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
