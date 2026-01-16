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
        const unit = await parseFile(filesToIndex[i], project.name)
        codeUnits.push(unit)
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

      const results = await indexStore.search(query, parseInt(options.limit))
      spinner.succeed(`找到 ${results.length} 个结果`)

      results.forEach((result: any, index: number) => {
        console.log(chalk.cyan(`\n[${index + 1}] ${result.name}`))
        console.log(chalk.gray(`  项目: ${result.project}`))
        console.log(chalk.gray(`  文件: ${result.filePath}`))
        console.log(chalk.gray(`  相似度: ${(1 - result.score).toFixed(4)}`))
        console.log(chalk.gray(`  行号: ${result.startLine}-${result.endLine}`))
      })
    } catch (error) {
      spinner.fail('搜索失败')
      console.error(chalk.red(error instanceof Error ? error.message : error))
      process.exit(1)
    }
  })

program.parse()
