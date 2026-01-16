#!/usr/bin/env node

const path = require('path');

async function main() {
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  console.log('🔍 开始搜索...\n');

  const config = await loadConfig();

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
  });

  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  const query = '用户登录流程';
  console.log(`查询: "${query}"\n`);

  const results = await indexStore.search(query, 10);

  console.log(`✓ 找到 ${results.length} 个结果:\n`);

  results.forEach((result, index) => {
    console.log(`[${index + 1}] ${result.name}`);
    console.log(`   项目: ${result.project}`);
    console.log(`   文件: ${result.filePath}`);
    console.log(`   相似度: ${(1 - result.score).toFixed(4)}`);
    console.log(`   行号: ${result.startLine}-${result.endLine}`);
    console.log();
  });

  console.log('✅ 查询完成！');
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});
