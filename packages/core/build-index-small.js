#!/usr/bin/env node

const path = require('path');

async function main() {
  const { scanDirectory } = require('./packages/core/dist/parser/scanner.js');
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const projectName = process.argv[2] || 'mallsite-res';
  const maxFiles = parseInt(process.argv[3]) || 50;

  console.log('🚀 开始构建索引（测试模式）...\n');

  const config = await loadConfig();
  const project = config.projects.find(p => p.name === projectName);

  if (!project) {
    console.error(`❌ 没有找到项目: ${projectName}`);
    process.exit(1);
  }

  console.log(`📁 项目: ${project.name}`);
  console.log(`📂 路径: ${project.path}`);
  console.log(`📊 限制: ${maxFiles} 个文件\n`);

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
    timeout: 60000,
  });

  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  console.log('📝 扫描文件...');
  const files = await scanDirectory(project.path);
  
  // 过滤并限制文件数量
  const targetFiles = files
    .filter(f => f.size > 100 && f.size < 50000)  // 只处理中等大小的文件
    .filter(f => f.extension === '.vue' || f.extension === '.js')  // 只处理 Vue 和 JS 文件
    .slice(0, maxFiles);
  
  console.log(`✓ 准备索引 ${targetFiles.length} 个文件\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < targetFiles.length; i++) {
    const file = targetFiles[i];
    const progress = `[${i + 1}/${targetFiles.length}]`;
    
    try {
      console.log(`${progress} 处理: ${file.relativePath}`);
      const units = await parseFile(file, project.name);
      
      if (units.length > 0) {
        const result = await indexStore.indexCodeUnits(units);
        successCount += result.success;
        failCount += result.failed;
        console.log(`  ✓ 成功: ${result.success}, 失败: ${result.failed}`);
      }
    } catch (err) {
      failCount++;
      console.log(`  ✗ 失败: ${err.message}`);
    }
  }

  console.log('\n✅ 索引构建完成！');
  console.log(`   成功: ${successCount} 个单元`);
  console.log(`   失败: ${failCount} 个单元\n`);
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  process.exit(1);
});
