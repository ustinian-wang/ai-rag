#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import Table from 'cli-table3'
import path from 'path'
import { addProject, getProjects, getProject, updateProject, loadConfig } from '../../core/dist/config/index.js'
import { scanDirectory } from '../../core/dist/parser/scanner.js'
import { parseFile } from '../../core/dist/parser/index.js'
import { IndexStore } from '../../core/dist/search/index.js'
import { OllamaClient } from '../../core/dist/vectorizer/ollama.js'

const program = new Command()

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
  .argument('<project-id>', '项目 ID')
  .option('-l, --limit <number>', '限制索引文件数量', '100')
  .action(async (projectId, options) => {
    const spinner = ora('正在构建索引...').start()

    try {
      const project = await getProject(projectId)
      if (!project) {
        spinner.fail('项目不存在')
        process.exit(1)
      }

      const config = await loadConfig()
      const ollamaClient = new OllamaClient({
        baseUrl: config.ollama.baseUrl,
        embeddingModel: config.ollama.embeddingModel,
      })

      const indexStore = new IndexStore(
        path.join(process.cwd(), config.storage.lanceDir),
        ollamaClient
      )

      spinner.text = '扫描文件...'
      const files = await scanDirectory(project.path)
      spinner.text = `找到 ${files.length} 个文件，开始解析...`

      const limit = parseInt(options.limit)
      const filesToIndex = files.slice(0, limit)
      const codeUnits = []

      for (let i = 0; i < filesToIndex.length; i++) {
        spinner.text = `解析文件 ${i + 1}/${filesToIndex.length}...`
        const units = await parseFile(filesToIndex[i], project.name)
        codeUnits.push(...units)
      }

      spinner.text = '生成向量并存储...'
      await indexStore.indexCodeUnits(codeUnits)

      await updateProject(projectId, {
        indexed: true,
        lastIndexed: new Date().toISOString(),
      })

      spinner.succeed(`索引构建完成！已索引 ${codeUnits.length} 个文件`)
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
