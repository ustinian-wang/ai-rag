#!/usr/bin/env node

const path = require('path');

async function main() {
  const { scanDirectory } = require('./packages/core/dist/parser/scanner.js');
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const projectName = process.argv[2];

  if (!projectName) {
    console.log('使用方法: node build-project-index.js <项目名称>');
    console.log('示例: node build-project-index.js mallsite-res');
    process.exit(1);
  }

  console.log('🚀 开始构建索引...\n');

  const config = await loadConfig();
  const project = config.projects.find(p => p.name === projectName);

  if (!project) {
    console.error(`❌ 没有找到项目: ${projectName}`);
    console.log('\n可用项目:');
    config.projects.forEach(p => console.log(`  - ${p.name}`));
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

  const targetFiles = files.filter(f => f.size > 0 && f.size < 500000);
  console.log(`📊 准备索引 ${targetFiles.length} 个文件\n`);

  const batchSize = 20;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < targetFiles.length; i += batchSize) {
    const batch = targetFiles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(targetFiles.length / batchSize);

    console.log(`[批次 ${batchNum}/${totalBatches}] 处理 ${batch.length} 个文件...`);

    for (const file of batch) {
      try {
        const units = await parseFile(file, project.name);
        if (units.length > 0) {
          await indexStore.addUnits(units);
          successCount++;
          console.log(`  ✓ ${path.basename(file.path)} (${units.length} units)`);
        }
      } catch (err) {
        failCount++;
        console.log(`  ⚠️  解析失败: ${path.basename(file.path)}`);
      }
    }

    console.log(`  ✅ 成功索引 ${batch.filter((_, idx) => idx < successCount - (i === 0 ? 0 : i)).length} 个文件\n`);
  }

  console.log('✅ 索引构建完成！');
  console.log(`   成功: ${successCount} 个文件`);
  console.log(`   失败: ${failCount} 个文件\n`);
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  process.exit(1);
});
