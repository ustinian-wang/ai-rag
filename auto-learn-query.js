#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { AutoLearnSearch } = require('./packages/core/dist/search/autoLearnSearch.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const query = process.argv[2] || '外卖模板的逻辑是什么样的';

  console.log('🤖 自动学习 RAG 查询系统\n');

  const config = await loadConfig();

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
    chatModel: 'qwen2.5-coder:14b',
  });

  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  const autoLearnSearch = new AutoLearnSearch(
    ollamaClient,
    indexStore,
    path.join(process.cwd(), '.rag-vocabulary.json')
  );

  // 初始化（加载或学习词汇）
  await autoLearnSearch.initialize();

  // 显示词汇统计
  const stats = autoLearnSearch.getVocabStats();
  console.log(`\n📊 词汇统计: 共 ${stats.total} 个领域词汇`);
  console.log('   高频词汇 TOP 20:');
  stats.top20.slice(0, 10).forEach((item, i) => {
    console.log(`   ${i + 1}. ${item.word} (${item.freq}次)`);
  });

  // 执行搜索
  const results = await autoLearnSearch.search(query, {
    limit: 10,
    fileTypes: ['.js', '.md']
  });

  if (results.length === 0) {
    console.log('\n❌ 没有找到相关代码');
    return;
  }

  // 读取文件内容
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

  // LLM 分析
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
