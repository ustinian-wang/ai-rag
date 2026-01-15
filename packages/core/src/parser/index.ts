import fs from 'fs/promises'
import path from 'path'
import { ScannedFile } from './scanner'
import { CodeUnit } from '../types'

export async function parseFile(file: ScannedFile, projectName: string): Promise<CodeUnit> {
  const content = await fs.readFile(file.path, 'utf-8')

  // 构建富含语义信息的文本
  const semanticText = buildSemanticText(file, content)

  return {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'file',
    name: path.basename(file.path),
    content: semanticText,
    filePath: file.path,
    project: projectName,
    startLine: 1,
    endLine: content.split('\n').length,
    dependencies: extractDependencies(content),
    metadata: {
      extension: file.extension,
      size: file.size,
      relativePath: file.relativePath,
    },
  }
}

function buildSemanticText(file: ScannedFile, content: string): string {
  return `文件路径: ${file.relativePath}
类型: ${getFileType(file.extension)}
文件名: ${path.basename(file.path)}

代码内容:
${content}
`
}

function getFileType(ext: string): string {
  const types: Record<string, string> = {
    '.js': 'JavaScript',
    '.ts': 'TypeScript',
    '.jsx': 'React JSX',
    '.tsx': 'React TSX',
    '.vue': 'Vue组件',
    '.json': 'JSON配置',
    '.md': 'Markdown文档',
  }
  return types[ext] || '代码文件'
}

function extractDependencies(content: string): string[] {
  const deps: string[] = []
  const importRegex = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g
  let match
  while ((match = importRegex.exec(content)) !== null) {
    deps.push(match[1])
  }
  return deps
}
