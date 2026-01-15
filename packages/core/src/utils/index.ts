/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 计算文件哈希（用于增量更新检测）
 */
export async function calculateFileHash(content: string): Promise<string> {
  const crypto = await import('crypto')
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * 规范化文件路径
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}
