/**
 * 测试文件分块功能
 */

import { scanDirectory } from './packages/core/src/parser/scanner.js'
import { parseFile } from './packages/core/src/parser/index.js'
import { IndexStore } from './packages/core/src/search/index.js'
import { OllamaClient } from './packages/core/src/vectorizer/ollama.js'
import path from 'path'

async function testChunking() {
  console.log('=== 测试文件分块功能 ===\n')

  // 1. 扫描测试目录
  const testDir = path.join(process.cwd(), 'packages/core/src')
  console.log(`扫描目录: ${testDir}`)

  const files = await scanDirectory(testDir)
  console.log(`找到 ${files.length} 个文件\n`)

  // 2. 解析第一个 TypeScript 文件
  const tsFile = files.find(f => f.extension === '.ts')
  if (!tsFile) {
    console.log('未找到 TypeScript 文件')
    return
  }

  console.log(`解析文件: ${tsFile.relativePath}`)

  // 测试不同粒度的解析
  console.log('\n--- 测试文件级别解析 ---')
  const fileUnits = await parseFile(tsFile, 'test-project', 'file')
  console.log(`生成 ${fileUnits.length} 个 CodeUnit`)
  fileUnits.forEach(unit => {
    console.log(`- ${unit.type}: ${unit.name} (${unit.startLine}-${unit.endLine})`)
  })

  console.log('\n--- 测试函数级别解析 ---')
  const functionUnits = await parseFile(tsFile, 'test-project', 'function')
  console.log(`生成 ${functionUnits.length} 个 CodeUnit`)
  functionUnits.forEach(unit => {
    console.log(`- ${unit.type}: ${unit.name} (${unit.startLine}-${unit.endLine})`)
  })

  console.log('\n--- 测试混合解析 (both) ---')
  const bothUnits = await parseFile(tsFile, 'test-project', 'both')
  console.log(`生成 ${bothUnits.length} 个 CodeUnit`)
  bothUnits.forEach(unit => {
    console.log(`- ${unit.type}: ${unit.name} (${unit.startLine}-${unit.endLine})`)
  })

  // 3. 测试 Vue 文件解析（如果有）
  const vueFile = files.find(f => f.extension === '.vue')
  if (vueFile) {
    console.log(`\n--- 测试 Vue 组件解析 ---`)
    console.log(`解析文件: ${vueFile.relativePath}`)
    const vueUnits = await parseFile(vueFile, 'test-project', 'both')
    console.log(`生成 ${vueUnits.length} 个 CodeUnit`)
    vueUnits.forEach(unit => {
      console.log(`- ${unit.type}: ${unit.name} (${unit.startLine}-${unit.endLine})`)
      if (unit.metadata.props) {
        console.log(`  Props: ${unit.metadata.props.join(', ')}`)
      }
      if (unit.metadata.emits) {
        console.log(`  Events: ${unit.metadata.emits.join(', ')}`)
      }
    })
  }

  // 4. 测试向量化和索引（需要 Ollama 运行）
  console.log('\n--- 测试向量化和索引 ---')
  try {
    const ollamaClient = new OllamaClient({
      baseUrl: 'http://localhost:11434',
      embeddingModel: 'nomic-embed-text',
    })

    // 检查 Ollama 健康状态
    const isHealthy = await ollamaClient.healthCheck()
    if (!isHealthy) {
      console.log('⚠️  Ollama 未运行，跳过向量化测试')
      return
    }

    console.log('✓ Ollama 运行正常')

    // 创建索引存储
    const dbPath = path.join(process.cwd(), '.ai-rag-data/test-lance')
    const indexStore = new IndexStore(dbPath, ollamaClient)

    // 索引前 3 个 CodeUnit
    const unitsToIndex = bothUnits.slice(0, 3)
    console.log(`\n索引 ${unitsToIndex.length} 个 CodeUnit...`)

    const result = await indexStore.indexCodeUnits(unitsToIndex)
    console.log(`✓ 成功: ${result.success}, 失败: ${result.failed}`)

    if (result.errors.length > 0) {
      console.log('\n错误详情:')
      result.errors.forEach(err => {
        console.log(`- ${err.unit.name}: ${err.error}`)
      })
    }

    // 测试搜索
    console.log('\n--- 测试搜索功能 ---')
    const searchResults = await indexStore.search('function', { limit: 5 })
    console.log(`找到 ${searchResults.length} 个结果`)
    searchResults.forEach((r, i) => {
      console.log(`${i + 1}. ${r.type}: ${r.name} (score: ${r.score.toFixed(4)})`)
    })

    // 测试过滤搜索
    console.log('\n--- 测试过滤搜索 ---')
    const filteredResults = await indexStore.search('function', {
      limit: 5,
      codeTypes: ['function'],
    })
    console.log(`找到 ${filteredResults.length} 个函数`)
    filteredResults.forEach((r, i) => {
      console.log(`${i + 1}. ${r.name} (score: ${r.score.toFixed(4)})`)
    })

    // 获取统计信息
    console.log('\n--- 索引统计信息 ---')
    const stats = await indexStore.getStats()
    console.log(`总计: ${stats.totalUnits} 个单元`)
    console.log('按类型:')
    Object.entries(stats.byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`)
    })
    console.log('按项目:')
    Object.entries(stats.byProject).forEach(([project, count]) => {
      console.log(`  ${project}: ${count}`)
    })

  } catch (error) {
    console.error('测试失败:', error)
  }

  console.log('\n=== 测试完成 ===')
}

testChunking().catch(console.error)
