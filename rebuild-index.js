#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { scanDirectory } = require('./packages/core/dist/parser/scanner.js');
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  console.log('🚀 重新构建索引（优先索引重要文件）...\n');

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

  // 优先索引重要文件（登录、API、核心业务逻辑）
  const priorityPatterns = [
    /login/i,
    /auth/i,
    /user/i,
    /api.*\.js$/,
    /store.*\.js$/,
  ];

  const priorityFiles = [];
  const normalFiles = [];

  for (const file of files) {
    if (file.size > 0 && file.size < 10000) { // 增加到 10KB
      const isPriority = priorityPatterns.some(pattern =>
        pattern.test(file.relativePath)
      );

      if (isPriority) {
        priorityFiles.push(file);
      } else {
        normalFiles.push(file);
      }
    }
  }

  console.log(`📊 优先文件: ${priorityFiles.length} 个`);
  console.log(`📊 普通文件: ${normalFiles.length} 个\n`);

  // 先索引优先文件
  const allFiles = [...priorityFiles, ...normalFiles];
  const batchSize = 10; // 减小批次大小
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < allFiles.length; i += batchSize) {
    const batch = allFiles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(allFiles.length / batchSize);

    const isPriorityBatch = i < priorityFiles.length;
    const batchType = isPriorityBatch ? '🔥 优先' : '📄 普通';

    console.log(`\n[批次 ${batchNum}/${totalBatches}] ${batchType} - 处理 ${batch.length} 个文件...`);

    const codeUnits = [];
    for (const file of batch) {
      try {
        const units = await parseFile(file, project.name); // 现在返回数组

        // 限制内容长度
        for (const unit of units) {
          if (unit.content.length > 1000) {
            unit.content = unit.content.substring(0, 1000) + '...';
          }
          codeUnits.push(unit);
        }

        console.log(`  ✓ ${file.relativePath} (${units.length} units)`);
      } catch (err) {
        console.log(`  ⚠️  解析失败: ${file.relativePath} - ${err.message}`);
        failCount++;
      }
    }

    if (codeUnits.length > 0) {
      try {
        await indexStore.indexCodeUnits(codeUnits);
        successCount += codeUnits.length;
        console.log(`  ✅ 成功索引 ${codeUnits.length} 个文件`);
      } catch (err) {
        console.log(`  ❌ 批次索引失败: ${err.message}`);
        failCount += codeUnits.length;
      }
    }

    // 优先批次之间增加延迟，避免 API 错误
    if (isPriorityBatch) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✅ 索引构建完成！`);
  console.log(`   成功: ${successCount} 个文件`);
  console.log(`   失败: ${failCount} 个文件\n`);
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});
