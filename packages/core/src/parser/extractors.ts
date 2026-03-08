import * as parser from '@babel/parser'
import traverse, { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { parse as parseVue } from '@vue/compiler-sfc'
import { CodeUnit } from '../types'

export interface ExtractedFunction {
  name: string
  type: 'function' | 'method' | 'arrow'
  params: string[]
  startLine: number
  endLine: number
  content: string
  isAsync: boolean
  isExported: boolean
  comments?: string
}

/**
 * 从 JS/TS 代码中提取函数
 */
export function extractFunctions(code: string, filePath: string): ExtractedFunction[] {
  const functions: ExtractedFunction[] = []
  const isVueFile = filePath.endsWith('.vue')

  try {
    // 尝试多种解析策略
    let ast
    try {
      ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx', 'decorators-legacy'],
        errorRecovery: true,
      })
    } catch (e) {
      // 如果失败，尝试作为脚本解析
      ast = parser.parse(code, {
        sourceType: 'script',
        plugins: ['jsx'],
        errorRecovery: true,
      })
    }

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const node = path.node
        if (node.loc && node.id) {
          functions.push({
            name: node.id.name,
            type: 'function',
            params: node.params.map((p: any) => t.isIdentifier(p) ? p.name : 'param'),
            startLine: node.loc.start.line,
            endLine: node.loc.end.line,
            content: code.split('\n').slice(node.loc.start.line - 1, node.loc.end.line).join('\n'),
            isAsync: node.async || false,
            isExported: path.parent.type === 'ExportNamedDeclaration' || path.parent.type === 'ExportDefaultDeclaration',
            comments: node.leadingComments?.map((c: any) => c.value).join('\n'),
          })
        }
      },

      ArrowFunctionExpression(path: NodePath<t.ArrowFunctionExpression>) {
        const node = path.node
        if (node.loc && path.parent.type === 'VariableDeclarator' && t.isIdentifier(path.parent.id)) {
          functions.push({
            name: path.parent.id.name,
            type: 'arrow',
            params: node.params.map((p: any) => t.isIdentifier(p) ? p.name : 'param'),
            startLine: node.loc.start.line,
            endLine: node.loc.end.line,
            content: code.split('\n').slice(node.loc.start.line - 1, node.loc.end.line).join('\n'),
            isAsync: node.async || false,
            isExported: false,
            comments: node.leadingComments?.map((c: any) => c.value).join('\n'),
          })
        }
      },

      ClassMethod(path: NodePath<t.ClassMethod>) {
        const node = path.node
        if (node.loc && t.isIdentifier(node.key)) {
          functions.push({
            name: node.key.name,
            type: 'method',
            params: node.params.map((p: any) => t.isIdentifier(p) ? p.name : 'param'),
            startLine: node.loc.start.line,
            endLine: node.loc.end.line,
            content: code.split('\n').slice(node.loc.start.line - 1, node.loc.end.line).join('\n'),
            isAsync: node.async || false,
            isExported: false,
            comments: node.leadingComments?.map((c: any) => c.value).join('\n'),
          })
        }
      },

      // Vue Options API: methods/computed/watch/lifecycle 的对象方法
      ObjectMethod(path: NodePath<t.ObjectMethod>) {
        if (!isVueFile) return
        const node = path.node
        const inExportDefault = !!path.findParent((p) => p.isExportDefaultDeclaration())
        if (!inExportDefault) return

        let methodName = ''
        if (t.isIdentifier(node.key)) {
          methodName = node.key.name
        } else if (t.isStringLiteral(node.key)) {
          methodName = node.key.value
        }

        if (node.loc && methodName) {
          functions.push({
            name: methodName,
            type: 'method',
            params: node.params.map((p: any) => t.isIdentifier(p) ? p.name : 'param'),
            startLine: node.loc.start.line,
            endLine: node.loc.end.line,
            content: code.split('\n').slice(node.loc.start.line - 1, node.loc.end.line).join('\n'),
            isAsync: node.async || false,
            isExported: false,
            comments: node.leadingComments?.map((c: any) => c.value).join('\n'),
          })
        }
      },

      // Vue Options API: key: function() {} / key: () => {}
      ObjectProperty(path: NodePath<t.ObjectProperty>) {
        if (!isVueFile) return
        const node = path.node
        const inExportDefault = !!path.findParent((p) => p.isExportDefaultDeclaration())
        if (!inExportDefault || !node.loc) return

        const value = node.value
        const isFunctionLike = t.isFunctionExpression(value) || t.isArrowFunctionExpression(value)
        if (!isFunctionLike) return

        let fnName = ''
        if (t.isIdentifier(node.key)) {
          fnName = node.key.name
        } else if (t.isStringLiteral(node.key)) {
          fnName = node.key.value
        }
        if (!fnName) return

        functions.push({
          name: fnName,
          type: t.isArrowFunctionExpression(value) ? 'arrow' : 'function',
          params: value.params.map((p: any) => t.isIdentifier(p) ? p.name : 'param'),
          startLine: value.loc?.start.line || node.loc.start.line,
          endLine: value.loc?.end.line || node.loc.end.line,
          content: code
            .split('\n')
            .slice((value.loc?.start.line || node.loc.start.line) - 1, value.loc?.end.line || node.loc.end.line)
            .join('\n'),
          isAsync: value.async || false,
          isExported: false,
          comments: value.leadingComments?.map((c: any) => c.value).join('\n'),
        })
      },
    })
  } catch (error) {
    // 静默失败，不打印错误
  }

  return functions
}

/**
 * 从 Vue 组件中提取信息
 */
export function extractVueComponent(code: string, filePath: string): {
  template?: string
  script?: string
  scriptSetup?: string
  methods: ExtractedFunction[]
  props: string[]
  emits: string[]
} {
  try {
    const { descriptor } = parseVue(code, { filename: filePath })

    const result = {
      template: descriptor.template?.content,
      script: descriptor.script?.content,
      scriptSetup: descriptor.scriptSetup?.content,
      methods: [] as ExtractedFunction[],
      props: [] as string[],
      emits: [] as string[],
    }

    // 提取 script 中的方法
    if (descriptor.script?.content) {
      result.methods = extractFunctions(descriptor.script.content, filePath)
    }

    // 提取 script setup 中的方法
    if (descriptor.scriptSetup?.content) {
      const setupMethods = extractFunctions(descriptor.scriptSetup.content, filePath)
      result.methods.push(...setupMethods)
    }

    // 简单提取 props 和 emits（可以进一步优化）
    if (descriptor.script?.content) {
      const propsMatch = descriptor.script.content.match(/props:\s*\{([^}]+)\}/)
      if (propsMatch) {
        result.props = propsMatch[1].split(',').map(p => p.trim().split(':')[0].trim())
      }

      const emitsMatch = descriptor.script.content.match(/emits:\s*\[([^\]]+)\]/)
      if (emitsMatch) {
        result.emits = emitsMatch[1].split(',').map(e => e.trim().replace(/['"]/g, ''))
      }
    }

    return result
  } catch (error) {
    console.error(`解析 Vue 组件失败: ${filePath}`, error)
    return {
      methods: [],
      props: [],
      emits: [],
    }
  }
}

/**
 * 构建函数的语义文本
 */
export function buildFunctionSemanticText(
  func: ExtractedFunction,
  filePath: string,
  relativePath: string
): string {
  // 提取函数签名
  const signature = `${func.isAsync ? 'async ' : ''}${func.name}(${func.params.join(', ')})`

  // 提取关键信息
  const parts = [
    `文件: ${relativePath}`,
    `函数签名: ${signature}`,
    `类型: ${func.type === 'function' ? '函数声明' : func.type === 'method' ? '类方法' : '箭头函数'}`,
    func.isExported ? '导出函数' : '内部函数',
  ].filter(Boolean)

  // 添加注释（如果有）
  if (func.comments) {
    const cleanComments = func.comments.replace(/^\s*\*\s*/gm, '').trim()
    parts.push(`\n功能说明: ${cleanComments}`)
  }

  // 只取代码的前500字符作为摘要，避免噪音
  const codeSnippet = func.content.substring(0, 500)
  parts.push(`\n代码摘要:\n${codeSnippet}${func.content.length > 500 ? '...' : ''}`)

  return parts.join('\n')
}

/**
 * 构建 Vue 组件的语义文本
 */
export function buildVueComponentSemanticText(
  component: ReturnType<typeof extractVueComponent>,
  filePath: string,
  relativePath: string
): string {
  const parts = [
    `文件: ${relativePath}`,
    `类型: Vue组件`,
  ]

  // 组件接口信息
  if (component.props.length > 0) {
    parts.push(`\n组件属性 (Props): ${component.props.join(', ')}`)
  }

  if (component.emits.length > 0) {
    parts.push(`组件事件 (Emits): ${component.emits.join(', ')}`)
  }

  // 方法签名列表（不包含完整代码）
  if (component.methods.length > 0) {
    parts.push(`\n方法列表:`)
    component.methods.forEach(method => {
      const asyncPrefix = method.isAsync ? 'async ' : ''
      parts.push(`- ${asyncPrefix}${method.name}(${method.params.join(', ')})`)
    })
  }

  if (component.template) {
    parts.push(`\nTemplate:\n${component.template.substring(0, 500)}${component.template.length > 500 ? '...' : ''}`)
  }

  if (component.script || component.scriptSetup) {
    const scriptContent = component.scriptSetup || component.script || ''
    parts.push(`\nScript:\n${scriptContent}`)
  }

  return parts.join('\n')
}
