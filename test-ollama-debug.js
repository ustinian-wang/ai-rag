#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { scanDirectory } = require('./packages/core/dist/parser/scanner.js');
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  console.log('🔍 调试 Ollama API 问题...\n');

  const config = await loadConfig();
  const project = config.projects[0];

  if (!project) {
    console.error('❌ 没有找到项目配置');
    process.exit(1);
  }

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
  });

  console.log('📝 扫描文件...');
  const files = await scanDirectory(project.path);

  // 只选择最小的文件
  const smallFiles = files
    .filter(f => f.size < 1000)
    .sort((a, b) => a.size - b.size)
    .slice(0, 3);

  console.log(`\n测试 ${smallFiles.length} 个最小文件:\n`);

  for (let i = 0; i < smallFiles.length; i++) {
    const file = smallFiles[i];
    console.log(`\n[${i + 1}/${smallFiles.length}] ${file.relativePath} (${file.size} bytes)`);

    try {
      // 读取原始文件内容
      const rawContent = await fs.readFile(file.path, 'utf-8');
      console.log(`  原始内容长度: ${rawContent.length} 字符`);

      // 测试原始内容
      console.log('  测试 1: 原始文件内容...');
      try {
        await ollamaClient.generateEmbedding(rawContent);
        console.log('  ✓ 原始内容成功');
      } catch (err) {
        console.log(`  ✗ 原始内容失败: ${err.message}`);
      }

      // 解析文件
      const unit = await parseFile(file, project.name);
      console.log(`  解析后内容长度: ${unit.content.length} 字符`);

      // 测试解析后的内容
      console.log('  测试 2: 解析后的内容...');
      try {
        await ollamaClient.generateEmbedding(unit.content);
        console.log('  ✓ 解析后内容成功');
      } catch (err) {
        console.log(`  ✗ 解析后内容失败: ${err.message}`);

        // 尝试截断内容
        const truncated = unit.content.substring(0, 500);
        console.log('  测试 3: 截断到 500 字符...');
        try {
          await ollamaClient.generateEmbedding(truncated);
          console.log('  ✓ 截断内容成功');
        } catch (err2) {
          console.log(`  ✗ 截断内容也失败: ${err2.message}`);
        }
      }

    } catch (error) {
      console.log(`  ✗ 处理失败: ${error.message}`);
    }
  }

  console.log('\n✅ 调试完成');
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});
