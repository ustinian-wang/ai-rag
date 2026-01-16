#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

async function main() {
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  console.log('🚀 开始索引 mallsite-res 项目文件...\n');

  // 选择 maKit.js 文件
  const targetFile = '/Users/wangguangduo/faiscoApp/codebase/projects/mallsite-res/js/src/tools/maKit.js';

  if (!fs.existsSync(targetFile)) {
    console.error('❌ 文件不存在:', targetFile);
    process.exit(1);
  }

  const stats = fs.statSync(targetFile);
  const fileInfo = {
    path: targetFile,
    relativePath: 'src/tools/maKit.js',
    extension: '.js',
    size: stats.size
  };

  console.log('📊 文件信息:');
  console.log('  路径:', fileInfo.path);
  console.log('  大小:', fileInfo.size, 'bytes');

  // 解析文件
  console.log('\n🔍 解析文件...');
  const units = await parseFile(fileInfo, 'mallsite-res');
  console.log('✅ 解析成功! 生成了', units.length, '个代码单元');

  if (units.length > 0) {
    console.log('\n📝 代码单元列表:');
    units.forEach((unit, index) => {
      console.log(`  ${index + 1}. ${unit.type}: ${unit.name || '(匿名)'}`);
      console.log(`     位置: ${unit.startLine}-${unit.endLine} 行`);
      if (unit.description) {
        console.log(`     描述: ${unit.description.substring(0, 60)}...`);
      }
    });

    // 构建索引
    console.log('\n🔨 构建索引...');
    const config = await loadConfig();
    const ollamaClient = new OllamaClient({
      baseUrl: config.ollama.baseUrl,
      embeddingModel: config.ollama.embeddingModel,
    });

    const indexStore = new IndexStore(
      path.join(process.cwd(), config.storage.lanceDir),
      ollamaClient
    );

    const result = await indexStore.indexCodeUnits(units);
    console.log('✅ 索引构建完成!');
    console.log(`   成功: ${result.success} 个单元`);
    console.log(`   失败: ${result.failed} 个单元`);
  } else {
    console.log('⚠️  没有解析到代码单元');
  }

  console.log('\n✨ 完成!');
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});
