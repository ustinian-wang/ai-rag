import fs from 'fs/promises'
import path from 'path'
import { ScannedFile } from './scanner'
import { CodeUnit } from '../types'
import {
  extractFunctions,
  extractVueComponent,
  buildFunctionSemanticText,
  buildVueComponentSemanticText,
} from './extractors'

/**
 * 解析文件，支持多粒度解析
 * @param file 扫描到的文件信息
 * @param projectName 项目名称
 * @param granularity 解析粒度：'file' | 'function' | 'both'
 */
export async function parseFile(
  file: ScannedFile,
  projectName: string,
  granularity: 'file' | 'function' | 'both' = 'both'
): Promise<CodeUnit[]> {
  const content = await fs.readFile(file.path, 'utf-8')
  const units: CodeUnit[] = []

  // 文件级别的 CodeUnit
  if (granularity === 'file' || granularity === 'both') {
    const fileUnit = createFileUnit(file, content, projectName)
    units.push(fileUnit)
  }

  // 函数/组件级别的 CodeUnit
  if (granularity === 'function' || granularity === 'both') {
    const functionUnits = await extractFunctionUnits(file, content, projectName)
    units.push(...functionUnits)
  }

  return units
}

/**
 * 创建文件级别的 CodeUnit
 */
function createFileUnit(file: ScannedFile, content: string, projectName: string): CodeUnit {
  const semanticText = buildSemanticText(file, content)

  return {
    id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

/**
 * 提取函数/组件级别的 CodeUnit
 */
async function extractFunctionUnits(
  file: ScannedFile,
  content: string,
  projectName: string
): Promise<CodeUnit[]> {
  const units: CodeUnit[] = []

  // Vue 组件特殊处理
  if (file.extension === '.vue') {
    const vueComponent = extractVueComponent(content, file.path)

    // 为整个 Vue 组件创建一个 CodeUnit
    const componentSemanticText = buildVueComponentSemanticText(
      vueComponent,
      file.path,
      file.relativePath
    )

    units.push({
      id: `component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'component',
      name: path.basename(file.path, '.vue'),
      content: componentSemanticText,
      filePath: file.path,
      project: projectName,
      startLine: 1,
      endLine: content.split('\n').length,
      dependencies: extractDependencies(content),
      metadata: {
        extension: file.extension,
        relativePath: file.relativePath,
        props: vueComponent.props,
        emits: vueComponent.emits,
      },
    })

    // 为每个方法创建 CodeUnit
    vueComponent.methods.forEach(method => {
      const methodSemanticText = buildFunctionSemanticText(method, file.path, file.relativePath)
      units.push({
        id: `method-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'function',
        name: method.name,
        content: methodSemanticText,
        filePath: file.path,
        project: projectName,
        startLine: method.startLine,
        endLine: method.endLine,
        dependencies: [],
        metadata: {
          extension: file.extension,
          relativePath: file.relativePath,
          functionType: method.type,
          isAsync: method.isAsync,
          isExported: method.isExported,
          params: method.params,
        },
      })
    })
  }
  // JS/TS 文件处理
  else if (['.js', '.ts', '.jsx', '.tsx'].includes(file.extension)) {
    const functions = extractFunctions(content, file.path)

    functions.forEach(func => {
      const functionSemanticText = buildFunctionSemanticText(func, file.path, file.relativePath)
      units.push({
        id: `function-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'function',
        name: func.name,
        content: functionSemanticText,
        filePath: file.path,
        project: projectName,
        startLine: func.startLine,
        endLine: func.endLine,
        dependencies: [],
        metadata: {
          extension: file.extension,
          relativePath: file.relativePath,
          functionType: func.type,
          isAsync: func.isAsync,
          isExported: func.isExported,
          params: func.params,
        },
      })
    })
  }

  return units
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
