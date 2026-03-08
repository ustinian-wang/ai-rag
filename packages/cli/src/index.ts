#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import Table from 'cli-table3'
import path from 'path'
import fs from 'fs/promises'
import { addProject, getProjects, getProject, updateProject, loadConfig } from '../../core/dist/config/index.js'
import { scanDirectory } from '../../core/dist/parser/scanner.js'
import { parseFile } from '../../core/dist/parser/index.js'
import { IndexStore } from '../../core/dist/search/index.js'
import { OllamaClient } from '../../core/dist/vectorizer/ollama.js'

const program = new Command()

interface IndexedFileState {
  mtimeMs: number
  size: number
}

interface ProjectIndexState {
  projectId: string
  updatedAt: string
  files: Record<string, IndexedFileState>
}

function getIndexStatePath(projectId: string): string {
  return path.join(process.cwd(), '.ai-rag-data', 'index-state', `${projectId}.json`)
}

async function loadIndexState(projectId: string): Promise<ProjectIndexState | null> {
  try {
    const filePath = getIndexStatePath(projectId)
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as ProjectIndexState
  } catch {
    return null
  }
}

async function saveIndexState(projectId: string, files: Record<string, IndexedFileState>): Promise<void> {
  const filePath = getIndexStatePath(projectId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const state: ProjectIndexState = {
    projectId,
    updatedAt: new Date().toISOString(),
    files,
  }
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

async function removeVectorsByFilePaths(dbPath: string, filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return

  const { connect } = await import('@lancedb/lancedb')

  try {
    const db = await connect(dbPath)
    const table = await db.openTable('code_units')

    for (const filePath of filePaths) {
      const safePath = escapeSqlString(filePath)
      await table.delete(`file_path = '${safePath}'`)
    }
  } catch {
    // 表不存在时跳过删除，后续 add 会自动创建
  }
}

function buildChatPrompt(
  question: string,
  results: Array<{
    filePath: string
    startLine: number
    endLine: number
    name: string
    type: string
    content: string
  }>
): string {
  const context = results
    .map((r, i) => {
      return [
        `来源[${i + 1}]`,
        `文件: ${r.filePath}:${r.startLine}-${r.endLine}`,
        `名称: ${r.name}`,
        `类型: ${r.type}`,
        '代码片段:',
        r.content,
      ].join('\n')
    })
    .join('\n\n---\n\n')

  return `你是一个前端代码助手。请基于给定代码上下文回答用户问题。

用户问题：
${question}

代码上下文：
${context}

回答要求：
1. 只根据给定上下文回答，不能编造未出现的实现细节。
2. 如果上下文不足，明确说"当前上下文不足以确定"，并说明还需要什么信息。
3. 先给出简洁结论，再给出依据。
4. 依据里必须引用来源编号（如：来源[1]、来源[2]）。
5. 最后给出 2-3 条可执行建议。
`
}

program
  .name('ai-rag')
  .description('AI RAG - 前端代码搜索系统 CLI')
  .version('1.0.0')

// 添加项目
program
  .command('add')
  .description('添加项目到配置')
  .argument('<name>', '项目名称')
  .argument('<path>', '项目路径')
  .action(async (name, projectPath) => {
    try {
      const project = await addProject(name, projectPath)
      console.log(chalk.green('✓ 项目添加成功'))
      console.log(chalk.gray(`  ID: ${project.id}`))
      console.log(chalk.gray(`  名称: ${project.name}`))
      console.log(chalk.gray(`  路径: ${project.path}`))
    } catch (error) {
      console.error(chalk.red('✗ 添加项目失败:'), error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// 列出项目
program
  .command('list')
  .description('列出所有项目')
  .action(async () => {
    try {
      const projects = await getProjects()

      if (projects.length === 0) {
        console.log(chalk.yellow('没有项目'))
        return
      }

      const table = new Table({
        head: ['ID', '名称', '路径', '已索引', '最后索引时间'],
        colWidths: [20, 20, 40, 10, 25]
      })

      projects.forEach((p: any) => {
        table.push([
          p.id.substring(0, 18),
          p.name,
          p.path.substring(0, 38),
          p.indexed ? '是' : '否',
          p.lastIndexed || '-'
        ])
      })

      console.log(table.toString())
    } catch (error) {
      console.error(chalk.red('✗ 获取项目列表失败:'), error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// 构建索引
program
  .command('index')
  .description('构建项目索引')
  .argument('<project>', '项目 ID 或项目名称')
  .option('-l, --limit <number>', '限制索引文件数量', '100')
  .option('-i, --incremental', '增量构建：仅重建变更文件（含删除同步）')
  .action(async (projectInput, options) => {
    const spinner = ora('正在构建索引...').start()

    try {
      const projectById = await getProject(projectInput)
      const projectList = projectById ? [] : await getProjects()
      const projectByName = projectById
        ? null
        : projectList.find((item: any) => item.name === projectInput)
      const project = projectById || projectByName

      if (!project) {
        spinner.fail(`项目不存在: ${projectInput}`)
        process.exit(1)
      }
      const projectId = project.id

      const config = await loadConfig()
      const ollamaClient = new OllamaClient({
        baseUrl: config.ollama.baseUrl,
        embeddingModel: config.ollama.embeddingModel,
      })

      const indexStore = new IndexStore(
        path.join(process.cwd(), config.storage.lanceDir),
        ollamaClient
      )
      const dbPath = path.join(process.cwd(), config.storage.lanceDir)

      spinner.text = '扫描文件...'
      const files = await scanDirectory(project.path)
      spinner.text = `Found ${files.length} files, preparing index...`

      const limit = parseInt(options.limit)
      const fullFileState: Record<string, IndexedFileState> = {}
      const fileByRelativePath = new Map<string, any>()

      for (const file of files) {
        const stats = await fs.stat(file.path)
        fullFileState[file.relativePath] = {
          mtimeMs: stats.mtimeMs,
          size: file.size,
        }
        fileByRelativePath.set(file.relativePath, file)
      }

      let filesToIndex = files.slice(0, limit)
      let deletedRelativePaths: string[] = []

      if (options.incremental) {
        const previousState = await loadIndexState(projectId)
        const previousFiles = previousState?.files || {}

        const changedRelativePaths = Object.keys(fullFileState).filter((relativePath) => {
          const prev = previousFiles[relativePath]
          const next = fullFileState[relativePath]
          return !prev || prev.mtimeMs !== next.mtimeMs || prev.size !== next.size
        })

        deletedRelativePaths = Object.keys(previousFiles).filter(
          (relativePath) => !fullFileState[relativePath]
        )

        // 增量模式下必须处理所有变更文件，否则会导致状态和索引不一致
        filesToIndex = changedRelativePaths
          .map((relativePath) => fileByRelativePath.get(relativePath))
          .filter(Boolean)

        const changedAbsPaths = filesToIndex.map((f: any) => f.path)
        const deletedAbsPaths = deletedRelativePaths.map((relativePath) =>
          path.join(project.path, relativePath)
        )
        const removePaths = [...changedAbsPaths, ...deletedAbsPaths]

        if (removePaths.length > 0) {
          spinner.text = `Cleaning old vectors: ${removePaths.length} files...`
          await removeVectorsByFilePaths(dbPath, removePaths)
        }

        if (filesToIndex.length === 0 && deletedRelativePaths.length === 0) {
          await updateProject(projectId, {
            indexed: true,
            lastIndexed: new Date().toISOString(),
          })
          await saveIndexState(projectId, fullFileState)
          spinner.succeed('Incremental index complete: no changes detected')
          return
        }
      }

      const codeUnits = []

      for (let i = 0; i < filesToIndex.length; i++) {
        spinner.text = `Parsing file ${i + 1}/${filesToIndex.length}...`
        const units = await parseFile(filesToIndex[i], project.name)
        codeUnits.push(...units)
      }

      spinner.text = 'Generating embeddings and storing...'
      await indexStore.indexCodeUnits(codeUnits)

      await updateProject(projectId, {
        indexed: true,
        lastIndexed: new Date().toISOString(),
      })
      await saveIndexState(projectId, fullFileState)

      if (options.incremental) {
        spinner.succeed(
          `Incremental index complete: rebuilt ${filesToIndex.length} files, removed ${deletedRelativePaths.length} files`
        )
      } else {
        spinner.succeed(`Full index complete: processed ${filesToIndex.length} files`)
      }
    } catch (error) {
      spinner.fail('索引构建失败')
      console.error(chalk.red(error instanceof Error ? error.message : error))
      process.exit(1)
    }
  })

// 搜索代码
program
  .command('search')
  .description('搜索代码')
  .argument('<query>', '搜索查询')
  .option('-l, --limit <number>', '结果数量限制', '10')
  .option('-p, --project <name>', '指定项目名称')
  .option('-v, --verbose', '显示详细信息（包含完整文件内容）')
  .action(async (query, options) => {
    const spinner = ora('正在搜索...').start()

    try {
      const config = await loadConfig()
      const ollamaClient = new OllamaClient({
        baseUrl: config.ollama.baseUrl,
        embeddingModel: config.ollama.embeddingModel,
      })

      const indexStore = new IndexStore(
        path.join(process.cwd(), config.storage.lanceDir),
        ollamaClient
      )

      // 构建搜索选项
      const searchOptions: any = { limit: parseInt(options.limit) }
      if (options.project) {
        searchOptions.projects = [options.project]
        spinner.text = `正在 ${options.project} 项目中搜索...`
      }

      const results = await indexStore.search(query, searchOptions)
      spinner.succeed(`找到 ${results.length} 个结果${options.project ? ` (项目: ${options.project})` : ''}`)

      const fs = await import('fs/promises')

      for (let index = 0; index < results.length; index++) {
        const result = results[index]

        console.log(chalk.cyan(`\n${'='.repeat(80)}`))
        console.log(chalk.cyan.bold(`[${index + 1}/${results.length}] ${result.name}`))
        console.log(chalk.gray(`项目: ${result.project}`))
        console.log(chalk.gray(`文件: ${result.filePath}:${result.startLine}-${result.endLine}`))
        console.log(chalk.gray(`类型: ${result.type}`))
        console.log(chalk.gray(`相似度: ${(1 - result.score).toFixed(4)}`))

        // 显示依赖关系
        if (result.dependencies && result.dependencies.length > 0) {
          console.log(chalk.yellow(`\n依赖关系:`))
          result.dependencies.forEach((dep: string) => {
            console.log(chalk.gray(`  - ${dep}`))
          })
        }

        // 显示代码片段
        console.log(chalk.green(`\n代码片段:`))
        console.log(chalk.white(result.content.substring(0, 500)))
        if (result.content.length > 500) {
          console.log(chalk.gray('... (已截断)'))
        }

        // 如果启用 verbose 模式，显示完整文件内容
        if (options.verbose) {
          try {
            const fullContent = await fs.readFile(result.filePath, 'utf-8')
            console.log(chalk.blue(`\n完整文件内容:`))
            console.log(chalk.white(fullContent))
          } catch (error) {
            console.log(chalk.red(`无法读取文件: ${error instanceof Error ? error.message : error}`))
          }
        }
      }

      console.log(chalk.cyan(`\n${'='.repeat(80)}\n`))
      console.log(chalk.green(`提示: 使用 -v 或 --verbose 选项查看完整文件内容`))
    } catch (error) {
      spinner.fail('搜索失败')
      console.error(chalk.red(error instanceof Error ? error.message : error))
      process.exit(1)
    }
  })

// Chat 命令
program
  .command('chat')
  .description('基于代码索引进行问答（检索 + LLM 回答）')
  .argument('<question>', '问题描述')
  .option('-l, --limit <number>', '检索结果数量（向量召回）', '6')
  .option('-p, --project <name>', '指定项目名称')
  .option('-s, --show-sources', '显示引用来源详情')
  .option('--context-limit <number>', '用于回答的片段数量', '3')
  .option('--snippet-chars <number>', '每个片段最大字符数', '500')
  .option('-m, --model <name>', '指定聊天模型（如 qwen2.5-coder:7b）')
  .option('--fast', '快速模式（更少上下文，更快回答）')
  .action(async (question, options) => {
    const spinner = ora('正在进行问答分析...').start()
    const totalStart = Date.now()

    try {
      const config = await loadConfig()
      const searchLimit = Math.max(1, parseInt(options.limit))
      const contextLimit = Math.max(1, parseInt(options.contextLimit))
      const snippetChars = Math.max(200, parseInt(options.snippetChars))
      const fastMode = !!options.fast

      const finalContextLimit = fastMode ? Math.min(contextLimit, 2) : contextLimit
      const finalSnippetChars = fastMode ? Math.min(snippetChars, 320) : snippetChars

      const ollamaClient = new OllamaClient({
        baseUrl: config.ollama.baseUrl,
        embeddingModel: config.ollama.embeddingModel,
        chatModel: options.model || (config as any).ollama?.chatModel,
      })

      const indexStore = new IndexStore(
        path.join(process.cwd(), config.storage.lanceDir),
        ollamaClient
      )

      const searchOptions: any = { limit: searchLimit }
      if (options.project) {
        searchOptions.projects = [options.project]
      }

      spinner.text = '正在检索相关代码...'
      const searchStart = Date.now()
      const results = await indexStore.search(question, searchOptions)
      const searchCostMs = Date.now() - searchStart

      if (results.length === 0) {
        spinner.warn('没有找到相关代码，无法生成可靠回答')
        console.log(chalk.yellow('请先确认已建立索引，或更换问题描述后重试。'))
        return
      }

      // 仅保留回答阶段最有价值的上下文，减少 token 可显著加速
      const contextResults = results.slice(0, finalContextLimit).map((r) => ({
        ...r,
        content: r.content.substring(0, finalSnippetChars),
      }))

      spinner.text = '正在生成回答...'
      const chatStart = Date.now()
      const prompt = buildChatPrompt(question, contextResults)
      const answer = await ollamaClient.chat(prompt)
      const chatCostMs = Date.now() - chatStart
      const totalCostMs = Date.now() - totalStart

      spinner.succeed(`问答完成（检索 ${results.length}，回答参考 ${contextResults.length}）`)

      console.log(chalk.cyan(`\n${'='.repeat(80)}`))
      console.log(chalk.cyan.bold('💬 问题'))
      console.log(chalk.cyan(`${'='.repeat(80)}\n`))
      console.log(chalk.white(question))

      console.log(chalk.cyan(`\n${'='.repeat(80)}`))
      console.log(chalk.cyan.bold('🧠 回答'))
      console.log(chalk.cyan(`${'='.repeat(80)}\n`))
      console.log(chalk.white(answer.trim()))

      console.log(chalk.cyan(`\n${'='.repeat(80)}`))
      console.log(chalk.cyan.bold('⏱️ 耗时'))
      console.log(chalk.cyan(`${'='.repeat(80)}\n`))
      console.log(chalk.gray(`检索耗时: ${(searchCostMs / 1000).toFixed(2)}s`))
      console.log(chalk.gray(`回答耗时: ${(chatCostMs / 1000).toFixed(2)}s`))
      console.log(chalk.gray(`总耗时: ${(totalCostMs / 1000).toFixed(2)}s`))

      if (options.showSources) {
        console.log(chalk.cyan(`\n${'='.repeat(80)}`))
        console.log(chalk.cyan.bold('📚 引用来源'))
        console.log(chalk.cyan(`${'='.repeat(80)}\n`))

        contextResults.forEach((r, i) => {
          console.log(chalk.green(`[${i + 1}] ${r.name}`))
          console.log(chalk.gray(`    文件: ${r.filePath}:${r.startLine}-${r.endLine}`))
          console.log(chalk.gray(`    类型: ${r.type}`))
          console.log(chalk.gray(`    距离: ${r.score.toFixed(4)}`))
        })
      }

      console.log(chalk.cyan(`\n${'='.repeat(80)}\n`))
      console.log(chalk.green('提示: 可用 --fast、--context-limit、--snippet-chars、--model 继续提速'))
    } catch (error) {
      spinner.fail('问答失败')
      console.error(chalk.red(error instanceof Error ? error.message : error))
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack))
      }
      process.exit(1)
    }
  })

// 智能分析命令
program
  .command('analyze')
  .description('智能分析缺陷（使用 LLM 分析问题并定位代码）')
  .argument('<bug-description>', '缺陷描述')
  .option('-p, --project <name>', '指定项目名称')
  .option('-l, --limit <number>', '结果数量限制', '10')
  .action(async (bugDescription, options) => {
    const spinner = ora('正在进行智能分析...').start()

    try {
      const config = await loadConfig()
      const ollamaClient = new OllamaClient({
        baseUrl: config.ollama.baseUrl,
        embeddingModel: config.ollama.embeddingModel,
      })

      const indexStore = new IndexStore(
        path.join(process.cwd(), config.storage.lanceDir),
        ollamaClient
      )

      // 动态导入 IntelligentAnalyzer
      const { IntelligentAnalyzer } = await import('../../core/dist/analyzer/index.js')
      const analyzer = new IntelligentAnalyzer(ollamaClient, indexStore)

      spinner.text = '正在分析缺陷描述...'

      const result = await analyzer.analyze(bugDescription, {
        project: options.project,
        maxResults: parseInt(options.limit),
      })

      spinner.succeed('智能分析完成！')

      // 显示分析结果
      console.log(chalk.cyan(`\n${'='.repeat(80)}`))
      console.log(chalk.cyan.bold(`📋 问题分析`))
      console.log(chalk.cyan(`${'='.repeat(80)}\n`))

      console.log(chalk.yellow(`组件名称: ${result.bugAnalysis.componentName}`))
      console.log(chalk.yellow(`问题现象: ${result.bugAnalysis.symptom}`))

      if (result.bugAnalysis.steps.length > 0) {
        console.log(chalk.yellow(`\n操作步骤:`))
        result.bugAnalysis.steps.forEach((step, i) => {
          console.log(chalk.gray(`  ${i + 1}. ${step}`))
        })
      }

      if (result.bugAnalysis.possibleCauses.length > 0) {
        console.log(chalk.yellow(`\n可能原因:`))
        result.bugAnalysis.possibleCauses.forEach((cause) => {
          console.log(chalk.gray(`  - ${cause}`))
        })
      }

      // 显示搜索结果
      console.log(chalk.cyan(`\n${'='.repeat(80)}`))
      console.log(chalk.cyan.bold(`🔍 相关代码 (${result.searchResults.length} 个)`))
      console.log(chalk.cyan(`${'='.repeat(80)}\n`))

      result.searchResults.slice(0, 5).forEach((r, i) => {
        console.log(chalk.green(`[${i + 1}] ${r.name}`))
        console.log(chalk.gray(`    文件: ${r.filePath}:${r.startLine}-${r.endLine}`))
        console.log(chalk.gray(`    类型: ${r.type}`))
        console.log(chalk.gray(`    相似度: ${(1 - r.score).toFixed(4)}`))
      })

      // 显示代码分析
      console.log(chalk.cyan(`\n${'='.repeat(80)}`))
      console.log(chalk.cyan.bold(`🔬 代码分析`))
      console.log(chalk.cyan(`${'='.repeat(80)}\n`))

      if (result.codeAnalysis.suspiciousCode.length > 0) {
        console.log(chalk.red(`可疑代码位置:`))
        result.codeAnalysis.suspiciousCode.forEach((code, i) => {
          const confidenceColor =
            code.confidence === 'high' ? chalk.red : code.confidence === 'medium' ? chalk.yellow : chalk.gray
          console.log(
            confidenceColor(
              `  [${i + 1}] ${code.filePath}:${code.startLine}-${code.endLine} (${code.confidence})`
            )
          )
          console.log(chalk.gray(`      原因: ${code.reason}`))
        })
      }

      if (result.codeAnalysis.dataFlow.length > 0) {
        console.log(chalk.blue(`\n数据流分析:`))
        result.codeAnalysis.dataFlow.forEach((flow) => {
          console.log(chalk.gray(`  - ${flow}`))
        })
      }

      if (result.codeAnalysis.fixSuggestions.length > 0) {
        console.log(chalk.green(`\n💡 修复建议:`))
        result.codeAnalysis.fixSuggestions.forEach((suggestion, i) => {
          console.log(chalk.white(`  ${i + 1}. ${suggestion}`))
        })
      }

      // 显示摘要
      console.log(chalk.cyan(`\n${'='.repeat(80)}`))
      console.log(chalk.cyan.bold(`📊 分析摘要`))
      console.log(chalk.cyan(`${'='.repeat(80)}\n`))
      console.log(chalk.white(result.summary))

      console.log(chalk.cyan(`\n${'='.repeat(80)}\n`))
    } catch (error) {
      spinner.fail('智能分析失败')
      console.error(chalk.red(error instanceof Error ? error.message : error))
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack))
      }
      process.exit(1)
    }
  })

program.parse()
