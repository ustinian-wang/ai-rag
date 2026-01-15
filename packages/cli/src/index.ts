#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'

const program = new Command()

program
  .name('ai-rag')
  .description('AI RAG - 前端代码搜索系统 CLI')
  .version('1.0.0')

program
  .command('init')
  .description('初始化配置')
  .action(() => {
    console.log(chalk.blue('初始化配置...'))
  })

program
  .command('server')
  .description('启动 Web 服务器')
  .option('-p, --port <port>', '端口号', '3000')
  .action((options) => {
    console.log(chalk.blue(`启动 Web 服务器，端口: ${options.port}`))
  })

program.parse()
