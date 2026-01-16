#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { scanDirectory } = require('./packages/core/dist/parser/scanner.js');
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  console.log('🚀 开始测试索引构建和搜索...\n');

  const config = await loadConfig();
  const project = config.projects[0];

  if (!project) {
    console.error('❌ 没有找到项目配置');
    process.exit(1);
  }

  console.log(`📁 项目: ${project.name}`);
  console.log(`📂 路径: ${project.path}\n`);

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
  });

  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  console.log('📝 扫描文件...');
  const files = await scanDirectory(project.path);
  console.log(`✓ 找到 ${files.length} 个文件\n`);

  // 只选择较小的文件进行索引
  const smallFiles = [];
  for (const file of files) {
    if (file.size < 10000 && smallFiles.length < 10) { // 只索引小于 10KB 的文件
      smallFiles.push(file);
    }
  }

  console.log(`📊 索引 ${smallFiles.length} 个小文件...\n`);

  const codeUnits = [];
  for (let i = 0; i < smallFiles.length; i++) {
    console.log(`[${i + 1}/${smallFiles.length}] ${smallFiles[i].relativePath} (${smallFiles[i].size} bytes)`);
    const unit = await parseFile(smallFiles[i], project.name);

    // 限制内容长度，避免 Ollama API 错误
    if (unit.content.length > 2000) {
      unit.content = unit.content.substring(0, 2000) + '...';
    }

    codeUnits.push(unit);
  }

  console.log('\n🔄 生成向量并存储...');
  await indexStore.indexCodeUnits(codeUnits);
  console.log('✓ 索引构建完成\n');

  console.log('🔍 搜索: "用户登录流程"\n');
  const results = await indexStore.search('用户登录流程', 5);

  console.log(`✓ 找到 ${results.length} 个结果:\n`);
  results.forEach((result, index) => {
    console.log(`[${index + 1}] ${result.name}`);
    console.log(`   项目: ${result.project}`);
    console.log(`   文件: ${result.filePath}`);
    console.log(`   相似度: ${(1 - result.score).toFixed(4)}`);
    console.log(`   行号: ${result.startLine}-${result.endLine}\n`);
  });

  console.log('✅ 测试完成！');
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});
