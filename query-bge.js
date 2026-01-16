#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  // 从命令行参数获取查询问题
  const query = process.argv[2];
  const topK = parseInt(process.argv[3]) || 20;

  if (!query) {
    console.log('使用方法: node query-bge.js "你的问题" [结果数量]');
    console.log('示例: node query-bge.js "如何实现用户登录" 10');
    process.exit(1);
  }

  console.log('🔍 RAG 查询系统 (BGE-M3)\n');
  console.log(`问题: "${query}"`);
  console.log(`检索数量: ${topK}\n`);

  // 加载配置
  const config = await loadConfig();
  const project = config.projects[0];

  console.log(`📦 项目: ${project.name}`);
  console.log(`🤖 嵌入模型: ${config.ollama.embeddingModel}`);
  console.log(`💬 对话模型: qwen2.5-coder:14b\n`);

  // 初始化 Ollama 客户端
  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
    chatModel: 'qwen2.5-coder:14b',
  });

  // 初始化索引存储
  const indexStore = new IndexStore(
    path.join(process.cwd(), config.storage.lanceDir),
    ollamaClient
  );

  // 步骤 1: 向量检索
  console.log('📝 步骤 1: 向量检索相关代码...');
  const results = await indexStore.search(query, topK);
  console.log(`✓ 找到 ${results.length} 个相关代码片段\n`);

  if (results.length === 0) {
    console.log('❌ 没有找到相关代码');
    return;
  }

  // 步骤 2: 读取文件内容
  console.log('📖 步骤 2: 读取文件内容...');
  const codeContext = [];
  for (const result of results) {
    try {
      const content = await fs.readFile(result.filePath, 'utf-8');
      codeContext.push({
        file: result.filePath,
        name: result.name,
        type: result.type,
        score: result.score.toFixed(4),
        content: content.substring(0, 3000),
      });
      console.log(`  ✓ ${result.name} (相似度: ${result.score.toFixed(4)})`);
    } catch (err) {
      console.log(`  ⚠️  无法读取: ${result.name}`);
    }
  }

  // 步骤 3: LLM 分析
  console.log('\n🤖 步骤 3: LLM 推理分析...\n');

  const contextText = codeContext.map((ctx, idx) =>
    `### 代码片段 ${idx + 1}: ${ctx.name} (${ctx.type})\n路径: ${ctx.file}\n相似度: ${ctx.score}\n\n\`\`\`\n${ctx.content}\n\`\`\``
  ).join('\n\n---\n\n');

  const messages = [
    {
      role: 'system',
      content: '你是一个专业的代码分析助手。基于提供的代码片段,分析并回答用户的问题。请用中文回答,要具体、准确,引用相关代码片段。'
    },
    {
      role: 'user',
      content: `问题: ${query}\n\n以下是通过向量检索找到的相关代码:\n\n${contextText}\n\n请基于以上代码,详细回答问题。如果代码中有具体的实现逻辑,请说明关键步骤。`
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
  process.exit(1);
});
