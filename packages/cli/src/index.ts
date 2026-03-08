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
const ENABLE_LEGACY_COMMANDS = process.env.AI_RAG_ENABLE_LEGACY_COMMANDS === '1'

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
4. 每条结论必须绑定至少一个来源编号（如：来源[1]、来源[2]）。
5. 严格按以下结构输出：## 结论、## 证据、## 不确定项、## 建议。
6. 如果无法给出带来源的结论，请在“## 不确定项”中明确说明。
`
}

type ChatSearchResult = {
  id: string
  filePath: string
  startLine: number
  endLine: number
  name: string
  type: string
  content: string
  score: number
  keywordMatches?: string[]
}

function evaluateEvidenceScore(result: ChatSearchResult): number {
  const filePath = result.filePath.toLowerCase()
  const name = result.name.toLowerCase()
  const content = result.content.toLowerCase()
  let score = 0

  // 优先代码语义单元
  if (result.type === 'function') score += 120
  if (result.type === 'component') score += 100
  if (result.type === 'file') score += 20

  // 优先 src 目录，降低 docs 干扰
  if (filePath.includes('/src/')) score += 80
  if (filePath.includes('/docs/')) score -= 140

  // 有关键词命中说明和问题语义更贴近
  score += (result.keywordMatches?.length || 0) * 25

  // 距离越小越好
  score += Math.max(0, 800 - result.score) * 0.1

  // 通用结构特征加分（无意图硬编码）
  if (/api|load|get|set|fetch|beforeenter|init|filter|handle|show/.test(name)) score += 40
  if (/router|api\/|setdata|vuex|watch|computed|template/.test(filePath + ' ' + content)) score += 30

  return score
}

function tokenizeQuery(query: string): string[] {
  const chineseWords = query.match(/[\u4e00-\u9fa5]{2,8}/g) || []
  const englishWords = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3)
  return [...new Set([...chineseWords, ...englishWords])]
}

function calcQueryCoverageScore(result: ChatSearchResult, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  const haystack = `${result.filePath} ${result.name} ${result.content}`.toLowerCase()
  let matched = 0
  queryTokens.forEach((t) => {
    if (haystack.includes(t.toLowerCase())) matched += 1
  })
  return matched * 40
}

function rerankForChat(results: ChatSearchResult[], query: string): ChatSearchResult[] {
  const queryTokens = tokenizeQuery(query)
  return [...results].sort((a, b) => {
    const scoreA = evaluateEvidenceScore(a) + calcQueryCoverageScore(a, queryTokens)
    const scoreB = evaluateEvidenceScore(b) + calcQueryCoverageScore(b, queryTokens)
    return scoreB - scoreA
  })
}

function hasEnoughCodeEvidence(results: ChatSearchResult[], query: string): boolean {
  const queryTokens = tokenizeQuery(query)
  const top = rerankForChat(results, query).slice(0, 4)
  const strongCodeCount = top.filter((r) => {
    const pathLower = r.filePath.toLowerCase()
    const isCodeType = r.type === 'function' || r.type === 'component'
    const isSrcCode = pathLower.includes('/src/')
    const notDoc = !pathLower.includes('/docs/')
    const hasQueryCoverage = calcQueryCoverageScore(r, queryTokens) > 0
    return isCodeType && isSrcCode && notDoc && hasQueryCoverage
  }).length

  return strongCodeCount >= 2
}

function mergeUniqueResults(primary: ChatSearchResult[], fallback: ChatSearchResult[]): ChatSearchResult[] {
  const merged = new Map<string, ChatSearchResult>()
  primary.forEach((r) => merged.set(r.id, r))
  fallback.forEach((r) => {
    if (!merged.has(r.id)) merged.set(r.id, r)
  })
  return Array.from(merged.values())
}

function selectChatContextResults(
  rerankedResults: ChatSearchResult[],
  vectorResults: ChatSearchResult[],
  query: string,
  limit: number
): ChatSearchResult[] {
  const relevanceOf = (r: ChatSearchResult): number => {
    return evaluateEvidenceScore(r) + calcQueryCoverageScore(r, queryTokens)
  }
  const similarityOf = (a: ChatSearchResult, b: ChatSearchResult): number => {
    const aTokens = tokenizeQuery(`${a.filePath} ${a.name} ${a.content}`)
    const bTokens = tokenizeQuery(`${b.filePath} ${b.name} ${b.content}`)
    if (aTokens.length === 0 || bTokens.length === 0) return 0
    const bSet = new Set(bTokens.map((t) => t.toLowerCase()))
    let inter = 0
    aTokens.forEach((t) => {
      if (bSet.has(t.toLowerCase())) inter += 1
    })
    const union = new Set([...aTokens.map((t) => t.toLowerCase()), ...bTokens.map((t) => t.toLowerCase())]).size
    return union === 0 ? 0 : inter / union
  }

  const selectByMMR = (candidates: ChatSearchResult[], topN: number, lambda = 0.7): ChatSearchResult[] => {
    if (candidates.length <= topN) return candidates.slice(0, topN)
    const selected: ChatSearchResult[] = []
    const remaining = [...candidates]
    remaining.sort((a, b) => relevanceOf(b) - relevanceOf(a))
    const first = remaining.shift()
    if (first) selected.push(first)

    while (selected.length < topN && remaining.length > 0) {
      let bestIndex = 0
      let bestScore = -Infinity
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]
        const relevance = relevanceOf(candidate)
        let maxSim = 0
        selected.forEach((s) => {
          maxSim = Math.max(maxSim, similarityOf(candidate, s))
        })
        const mmrScore = lambda * relevance - (1 - lambda) * maxSim * 100
        if (mmrScore > bestScore) {
          bestScore = mmrScore
          bestIndex = i
        }
      }
      selected.push(remaining.splice(bestIndex, 1)[0])
    }
    return selected
  }

  const queryTokens = tokenizeQuery(query)
  const selected = new Map<string, ChatSearchResult>()

  const rerankedHead = selectByMMR(rerankedResults, limit)
  rerankedHead.forEach((r) => selected.set(r.id, r))

  const vectorCandidates = vectorResults
    .map((r) => ({
      result: r,
      coverage: calcQueryCoverageScore(r, queryTokens),
    }))
    .filter((item) => {
      const pathLower = item.result.filePath.toLowerCase()
      const isCodeType = item.result.type === 'function' || item.result.type === 'component'
      return isCodeType && pathLower.includes('/src/') && !pathLower.includes('/docs/')
    })
    .sort((a, b) => b.coverage - a.coverage || a.result.score - b.result.score)

  for (const item of vectorCandidates) {
    if (selected.size >= limit) break
    if (item.coverage <= 0) continue
    selected.set(item.result.id, item.result)
  }

  return selectByMMR(Array.from(selected.values()), limit)
}

function extractRelevantSnippet(content: string, query: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  const queryTokens = tokenizeQuery(query).filter((t) => t.length >= 2)
  const contentLower = content.toLowerCase()

  let hitIndex = -1
  for (const token of queryTokens) {
    const idx = contentLower.indexOf(token.toLowerCase())
    if (idx >= 0) {
      hitIndex = idx
      break
    }
  }

  if (hitIndex < 0) {
    return `${content.substring(0, maxChars)}...`
  }

  const halfWindow = Math.floor(maxChars / 2)
  let start = Math.max(0, hitIndex - halfWindow)
  let end = Math.min(content.length, start + maxChars)
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars)
  }

  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''
  return `${prefix}${content.substring(start, end)}${suffix}`
}

function hasValidSourceCitation(answer: string, sourceCount: number): boolean {
  const matches = answer.match(/来源\[(\d+)\]/g) || []
  if (matches.length === 0) return false
  return matches.some((m) => {
    const num = Number(m.replace(/[^\d]/g, ''))
    return Number.isFinite(num) && num >= 1 && num <= sourceCount
  })
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

// 搜索代码（旧命令，默认不对外暴露）
if (ENABLE_LEGACY_COMMANDS) {
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
}

// Chat 命令
program
  .command('chat')
  .description('基于代码索引进行问答（检索 + LLM 回答）')
  .argument('<question>', '问题描述')
  .option('-l, --limit <number>', '检索结果数量（向量召回）', '8')
  .option('-p, --project <name>', '指定项目名称')
  .option('-s, --show-sources', '显示引用来源详情')
  .option('--context-limit <number>', '用于回答的片段数量', '6')
  .option('--snippet-chars <number>', '每个片段最大字符数', '1400')
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
      const smartResults = await indexStore.smartSearch(question, { ...searchOptions, enableRerank: false })
      const vectorResults = await indexStore.search(question, {
        ...searchOptions,
        limit: Math.max(searchLimit * 2, 12),
      })
      let results = mergeUniqueResults(smartResults as ChatSearchResult[], vectorResults as ChatSearchResult[])
      results = rerankForChat(results as ChatSearchResult[], question)

      // 仍然证据偏弱时，再次放大向量候选并重排
      if (!hasEnoughCodeEvidence(results as ChatSearchResult[], question)) {
        spinner.text = '检测到证据偏弱，追加更多向量候选...'
        const widerVectorResults = await indexStore.search(question, {
          ...searchOptions,
          limit: Math.max(searchLimit * 4, 20),
        })
        results = mergeUniqueResults(results as ChatSearchResult[], widerVectorResults as ChatSearchResult[])
        results = rerankForChat(results as ChatSearchResult[], question)
      }
      const searchCostMs = Date.now() - searchStart

      if (results.length === 0) {
        spinner.warn('没有找到相关代码，无法生成可靠回答')
        console.log(chalk.yellow('请先确认已建立索引，或更换问题描述后重试。'))
        return
      }

      // 仅保留回答阶段最有价值的上下文，减少 token 可显著加速
      // 同时做一次向量召回兜底，降低“命中但未入上下文”风险
      const selectedContextResults = selectChatContextResults(
        results as ChatSearchResult[],
        vectorResults as ChatSearchResult[],
        question,
        finalContextLimit
      )

      const contextResults = selectedContextResults.map((r) => ({
        ...r,
        content: extractRelevantSnippet(r.content, question, finalSnippetChars),
      }))

      spinner.text = '正在生成回答...'
      const chatStart = Date.now()
      const prompt = buildChatPrompt(question, contextResults)
      let answer = await ollamaClient.chat(prompt)
      if (!hasValidSourceCitation(answer, contextResults.length)) {
        spinner.text = '检测到回答缺少有效来源，进行一次强约束重试...'
        const strictPrompt = `${prompt}

你上一版回答缺少有效来源编号。请重写并满足：
1) 使用“## 结论 / ## 证据 / ## 不确定项 / ## 建议”四段。
2) “## 结论”中每条结论必须包含来源编号（来源[1]...）。
3) 只允许引用 1 到 ${contextResults.length} 的来源编号。
4) 若证据不足，明确写“当前上下文不足以确定”。`
        answer = await ollamaClient.chat(strictPrompt)
      }
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

// 智能分析命令（旧命令，默认不对外暴露）
if (ENABLE_LEGACY_COMMANDS) {
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
}

program.parse()
