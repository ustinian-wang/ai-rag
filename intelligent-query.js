#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { IntelligentSearch } = require('./packages/core/dist/search/intelligentSearch.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const query = process.argv[2] || '外卖模板的逻辑是什么样的';
  const vocabFile = path.join(process.cwd(), '.rag-vocabulary.json');

  console.log('🤖 智能 RAG 查询系统（自动学习版）\n');

  const config = await loadConfig();
  const project = config.projects[0];

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
    chatModel: 'qwen2.5-coder:14b',
  });

  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  const intelligentSearch = new IntelligentSearch(ollamaClient, indexStore);

  // 尝试加载已保存的领域词汇
  try {
    const vocabData = await fs.readFile(vocabFile, 'utf-8');
    const vocab = JSON.parse(vocabData);
    intelligentSearch.importVocabulary(vocab);
    console.log('✅ 已加载领域词汇缓存\n');
  } catch (err) {
    console.log('⚠️  未找到领域词汇缓存，将从代码库学习...\n');

    // 从索引中学习领域词汇
    const allResults = await indexStore.search('', { limit: 1000 });
    await intelligentSearch.learnDomainVocabulary(allResults);

    // 保存领域词汇
    const vocab = intelligentSearch.exportVocabulary();
    await fs.writeFile(vocabFile, JSON.stringify(vocab, null, 2));
    console.log(`✅ 已保存领域词汇到 ${vocabFile}\n`);
  }

  // 执行智能搜索
  const results = await intelligentSearch.intelligentSearch(query, {
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

    // 显示统计信息
    const stats = intelligentSearch.getQueryStats();
    console.log('\n📊 查询统计:');
    console.log(`   总查询数: ${stats.totalQueries}`);
    console.log(`   高频关键词: ${stats.topKeywords.slice(0, 5).map(k => k.keyword).join(', ')}`);
  } catch (err) {
    console.error('❌ LLM 推理失败:', err.message);
  }
}

main().catch(error => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});
