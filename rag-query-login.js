#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

async function main() {
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  const query = process.argv[2] || '登录流程是什么样的';

  console.log('🔍 RAG 查询系统（基于实际登录代码）\n');
  console.log(`问题: "${query}"\n`);

  const config = await loadConfig();

  const ollamaClient = new OllamaClient({
    baseUrl: config.ollama.baseUrl,
    embeddingModel: config.ollama.embeddingModel,
    chatModel: 'qwen2.5-coder:14b',
  });

  console.log('📖 读取登录相关代码文件...');

  // 直接读取我们找到的登录相关文件
  const loginFiles = [
    '/Users/wangguangduo/faiscoApp/codebase/projects/mallUniapp-res/src/api/loginApi.js',
    '/Users/wangguangduo/faiscoApp/codebase/projects/mallUniapp-res/src/utils/authorization/login.js',
    '/Users/wangguangduo/faiscoApp/codebase/projects/mallUniapp-res/src/utils/authorization/user.js',
  ];

  const codeContext = [];
  for (const filePath of loginFiles) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      codeContext.push({
        file: filePath,
        name: fileName,
        content: content.substring(0, 3000), // 限制长度
      });
      console.log(`  ✓ ${fileName}`);
    } catch (err) {
      console.log(`  ⚠️  无法读取: ${filePath}`);
    }
  }

  console.log('\n🤖 LLM 推理分析...\n');

  const contextText = codeContext.map((ctx, idx) =>
    `### 文件 ${idx + 1}: ${ctx.name}\n路径: ${ctx.file}\n\n\`\`\`javascript\n${ctx.content}\n\`\`\``
  ).join('\n\n---\n\n');

  const messages = [
    {
      role: 'system',
      content: '你是一个代码分析助手。基于提供的代码片段，详细分析并回答用户的问题。请用中文回答，要具体、准确，引用相关代码和函数名。'
    },
    {
      role: 'user',
      content: `问题: ${query}\n\n以下是登录相关的核心代码文件:\n\n${contextText}\n\n请基于以上代码，详细分析登录流程，包括：\n1. 主要的登录方式有哪些\n2. 登录流程的关键步骤\n3. 涉及的主要函数和API\n4. 登录成功后的处理逻辑`
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
