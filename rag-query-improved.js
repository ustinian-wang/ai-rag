#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const query = process.argv[2] || '登录流程是什么样的';

  console.log('🔍 改进的 RAG 查询系统\n');
  console.log(`问题: "${query}"\n`);

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

  // 步骤 1: 查询重写 - 将自然语言问题转换为技术关键词
  console.log('📝 步骤 1: 查询重写...');
  const rewriteMessages = [
    {
      role: 'system',
      content: '你是一个查询重写助手。将用户的自然语言问题转换为代码搜索关键词。只输出关键词，用空格分隔，不要有其他内容。'
    },
    {
      role: 'user',
      content: `用户问题: "${query}"\n\n请提取这个问题的核心技术关键词，包括：\n1. 可能的函数名\n2. 可能的文件名\n3. 技术术语\n4. API 名称\n\n只输出关键词，用空格分隔。`
    }
  ];

  let searchKeywords = query;
  try {
    searchKeywords = await ollamaClient.chat(rewriteMessages);
    searchKeywords = searchKeywords.trim();
    console.log(`✓ 重写后的查询: "${searchKeywords}"\n`);
  } catch (err) {
    console.log(`⚠️  查询重写失败，使用原始查询\n`);
  }

  // 步骤 2: 向量搜索
  console.log('📝 步骤 2: 向量搜索...');
  const results = await indexStore.search(searchKeywords, 15);
  console.log(`✓ 找到 ${results.length} 个相关文件\n`);

  if (results.length === 0) {
    console.log('❌ 没有找到相关代码');
    return;
  }

  // 步骤 3: 读取文件内容
  console.log('📖 步骤 3: 读取文件内容...');
  const codeContext = [];
  for (const result of results.slice(0, 8)) { // 只取前 8 个最相关的
    try {
      const content = await fs.readFile(result.filePath, 'utf-8');
      codeContext.push({
        file: result.filePath,
        name: result.name,
        similarity: (1 - result.score).toFixed(4),
        content: content.substring(0, 2000),
      });
      console.log(`  ✓ ${result.name} (相似度: ${(1 - result.score).toFixed(4)})`);
    } catch (err) {
      console.log(`  ⚠️  无法读取: ${result.name}`);
    }
  }

  // 步骤 4: LLM 推理分析
  console.log('\n🤖 步骤 4: LLM 推理分析...\n');

  const contextText = codeContext.map((ctx, idx) =>
    `### 文件 ${idx + 1}: ${ctx.name}\n路径: ${ctx.file}\n相似度: ${ctx.similarity}\n\n\`\`\`\n${ctx.content}\n\`\`\``
  ).join('\n\n---\n\n');

  const messages = [
    {
      role: 'system',
      content: '你是一个代码分析助手。基于提供的代码片段，分析并回答用户的问题。请用中文回答，要具体、准确，引用相关代码和函数名。如果代码片段不包含相关信息，请明确说明。'
    },
    {
      role: 'user',
      content: `原始问题: ${query}\n\n以下是搜索到的相关代码文件:\n\n${contextText}\n\n请基于以上代码，详细回答用户的问题。如果这些代码不包含相关信息，请说明需要查看哪些类型的文件。`
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
