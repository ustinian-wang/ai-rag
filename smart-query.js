#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const query = process.argv[2];
  const topK = parseInt(process.argv[3]) || 20;

  if (!query) {
    console.log('使用方法: node smart-query.js "你的问题" [结果数量]');
    console.log('示例: node smart-query.js "用户登录流程" 15');
    process.exit(1);
  }

  console.log('🔍 智能 RAG 查询系统 (BGE-M3)\n');
  console.log(`问题: "${query}"`);
  console.log(`检索数量: ${topK}\n`);

  const config = await loadConfig();
  const project = config.projects[0];

  console.log(`📦 项目: ${project.name}`);
  console.log(`🤖 嵌入模型: ${config.ollama.embeddingModel}`);
  console.log(`💬 对话模型: qwen2.5-coder:14b\n`);

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
    chatModel: 'qwen2.5-coder:14b',
  });

  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  // 使用智能搜索
  console.log('📝 步骤 1: 智能向量检索...');
  const results = await indexStore.smartSearch(query, {
    limit: topK,
    fileTypes: ['.js', '.vue', '.ts', '.md']
  });
  console.log(`✓ 找到 ${results.length} 个相关代码片段\n`);

  if (results.length === 0) {
    console.log('\n❌ 没有找到相关代码');
    return;
  }

  console.log('\n📖 步骤 4: 读取文件内容...');
  const codeContext = [];
  for (const result of results.slice(0, 5)) {
    try {
      const content = await fs.readFile(result.filePath, 'utf-8');
      const lines = content.split('\n');
      const snippet = lines.slice(result.startLine - 1, Math.min(result.endLine, result.startLine + 50)).join('\n');

      codeContext.push({
        file: result.filePath.split('mallUniapp-res/').pop() || result.filePath,
        name: result.name,
        type: result.type,
        similarity: (1 / (1 + result.score)).toFixed(4),
        content: snippet.substring(0, 2000),
        keywordMatches: result.keywordMatches || [],
      });
      console.log(`  ✓ ${result.name} (${result.type}) - 关键词: ${result.keywordMatches?.join(', ') || '无'}`);
    } catch (err) {
      console.log(`  ⚠️  无法读取: ${result.name}`);
    }
  }

  console.log('\n🤖 步骤 5: LLM 推理分析...\n');

  const contextText = codeContext.map((ctx, idx) =>
    `### 文件 ${idx + 1}: ${ctx.name} (${ctx.type})
路径: ${ctx.file}
相似度: ${ctx.similarity}
匹配关键词: ${ctx.keywordMatches.join(', ')}

\`\`\`javascript
${ctx.content}
\`\`\``
  ).join('\n\n---\n\n');

  const messages = [
    {
      role: 'system',
      content: '你是一个代码分析助手。基于提供的代码片段，分析并回答用户的问题。请用中文回答，要具体、准确，引用相关代码。'
    },
    {
      role: 'user',
      content: `问题: ${query}\n\n以下是相关的代码文件:\n\n${contextText}\n\n请基于以上代码，详细回答问题。`
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
