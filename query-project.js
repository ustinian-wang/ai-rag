#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const query = process.argv[2];
  const projectName = process.argv[3] || 'mallsite-res';

  if (!query) {
    console.log('使用方法: node query-project.js "你的问题" [项目名称]');
    console.log('');
    console.log('示例:');
    console.log('  node query-project.js "用户登录流程"');
    console.log('  node query-project.js "商品价格计算" mallsite-res');
    process.exit(1);
  }

  console.log('🔍 项目代码查询\n');
  console.log(`问题: "${query}"`);
  console.log(`项目: ${projectName}\n`);

  const config = await loadConfig();
  const project = config.projects.find(p => p.name === projectName);

  if (!project) {
    console.error(`❌ 没有找到项目: ${projectName}`);
    console.log('\n可用项目:');
    config.projects.forEach(p => console.log(`  - ${p.name}`));
    process.exit(1);
  }

  console.log(`📦 项目: ${project.name}`);
  console.log(`📂 路径: ${project.path}`);
  console.log(`🤖 模型: ${config.ollama.embeddingModel}\n`);

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
    chatModel: 'qwen2.5-coder:14b',
  });

  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  console.log('📝 智能向量检索...');
  const results = await indexStore.smartSearch(query, {
    limit: 10,
    projects: [projectName],
    fileTypes: ['.js', '.vue', '.ts']
  });
  console.log(`✓ 找到 ${results.length} 个相关代码片段\n`);

  if (results.length === 0) {
    console.log('❌ 没有找到相关代码');
    return;
  }

  console.log('📖 读取文件内容...');
  const codeContext = [];

  for (const result of results.slice(0, 5)) {
    try {
      const content = await fs.readFile(result.filePath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(0, result.startLine - 1);
      const endLine = Math.min(lines.length, result.endLine + 10);
      const snippet = lines.slice(startLine, endLine).join('\n');

      codeContext.push({
        file: result.filePath.replace(project.path, ''),
        name: result.name,
        type: result.type,
        similarity: (1 / (1 + result.score)).toFixed(4),
        startLine: result.startLine,
        endLine: result.endLine,
        content: snippet.substring(0, 2000),
        keywords: result.keywordMatches || [],
      });

      const keywordInfo = result.keywordMatches?.length > 0
        ? ` - 关键词: ${result.keywordMatches.join(', ')}`
        : '';
      console.log(`  ✓ ${result.name} (${result.type}) - 相似度: ${(1 / (1 + result.score)).toFixed(4)}${keywordInfo}`);
      console.log(`    位置: ${result.filePath.replace(project.path, '')}:${result.startLine}-${result.endLine}`);
    } catch (err) {
      console.log(`  ⚠️  无法读取: ${result.name}`);
    }
  }

  console.log('\n🤖 LLM 推理分析...\n');

  const contextText = codeContext.map((ctx, idx) =>
    `### 代码片段 ${idx + 1}: ${ctx.name} (${ctx.type})
路径: ${ctx.file}:${ctx.startLine}-${ctx.endLine}
相似度: ${ctx.similarity}
匹配关键词: ${ctx.keywords.join(', ') || '无'}

\`\`\`javascript
${ctx.content}
\`\`\``
  ).join('\n\n---\n\n');

  const messages = [
    {
      role: 'system',
      content: '你是一个专业的代码分析助手。基于提供的代码片段，分析并回答用户的问题。请用中文回答，要具体、准确，引用相关代码片段和文件位置。'
    },
    {
      role: 'user',
      content: `问题: ${query}\n\n以下是通过向量检索找到的相关代码:\n\n${contextText}\n\n请基于以上代码，详细回答问题。如果代码中有具体的实现逻辑，请说明关键步骤和文件位置。`
    }
  ];

  try {
    const answer = await ollamaClient.chat(messages);
    console.log('💡 分析结果:\n');
    console.log(answer);
    console.log('\n✅ 查询完成！');
  } catch (err) {
    console.error('❌ LLM 推理失败:', err.message);
  }
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});
