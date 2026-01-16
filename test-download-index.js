#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  console.log('🚀 开始下载并索引JS文件...\n');

  // 下载一个流行的JS库文件（lodash的debounce函数）
  const downloadUrl = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/debounce.js';
  const downloadPath = path.join(__dirname, 'test-files', 'lodash-debounce.js');

  // 确保目录存在
  const testDir = path.join(__dirname, 'test-files');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  console.log('📥 下载文件:', downloadUrl);
  await downloadFile(downloadUrl, downloadPath);
  console.log('✅ 下载完成:', downloadPath);

  // 获取文件信息
  const stats = fs.statSync(downloadPath);
  const fileInfo = {
    path: downloadPath,
    relativePath: 'test-files/lodash-debounce.js',
    extension: '.js',
    size: stats.size
  };

  console.log('\n📊 文件信息:');
  console.log('  路径:', fileInfo.path);
  console.log('  大小:', fileInfo.size, 'bytes');

  // 解析文件
  console.log('\n🔍 解析文件...');
  const units = await parseFile(fileInfo, 'test-project');
  console.log('✅ 解析成功! 生成了', units.length, '个代码单元');

  if (units.length > 0) {
    console.log('\n📝 代码单元列表:');
    units.forEach((unit, index) => {
      console.log(`  ${index + 1}. ${unit.type}: ${unit.name || '(匿名)'}`);
      console.log(`     位置: ${unit.startLine}-${unit.endLine} 行`);
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
