#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    query: null,
    topK: 10,
    project: 'mallsite-res',
    fileTypes: ['.js', '.vue', '.ts'],
    showCode: true,
    useLLM: true,
    codeTypes: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg === '--project' || arg === '-p') {
      options.project = args[++i];
    } else if (arg === '--limit' || arg === '-l') {
      options.topK = parseInt(args[++i]) || 10;
    } else if (arg === '--type' || arg === '-t') {
      options.fileTypes = args[++i].split(',');
    } else if (arg === '--code-type' || arg === '-c') {
      options.codeTypes = args[++i].split(',');
    } else if (arg === '--no-code') {
      options.showCode = false;
    } else if (arg === '--no-llm') {
      options.useLLM = false;
    } else if (!options.query) {
      options.query = arg;
    }
  }

  return options;
}

function showHelp() {
  console.log('使用方法: node query-mallsite.js "你的问题" [选项]');
  console.log('');
  console.log('选项:');
  console.log('  -p, --project <name>      指定项目名称 (默认: mallsite-res)');
  console.log('  -l, --limit <number>      返回结果数量 (默认: 10)');
  console.log('  -t, --type <types>        文件类型过滤，逗号分隔 (默认: .js,.vue,.ts)');
  console.log('  -c, --code-type <types>   代码类型过滤，逗号分隔 (如: function,class,component)');
  console.log('  --no-code                 不显示代码片段，仅显示文件位置');
  console.log('  --no-llm                  不使用 LLM 分析，仅显示搜索结果');
  console.log('  -h, --help                显示帮助信息');
  console.log('');
  console.log('示例:');
  console.log('  node query-mallsite.js "用户登录流程"');
  console.log('  node query-mallsite.js "商品价格计算" -l 15');
  console.log('  node query-mallsite.js "支付回调" -t .js,.ts');
  console.log('  node query-mallsite.js "Vue组件" -c component -t .vue');
  console.log('  node query-mallsite.js "工具函数" --no-llm');
  console.log('  node query-mallsite.js "API接口" -p mallsite-res -l 20');
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.query) {
    console.log('错误: 请提供查询问题');
    console.log('');
    showHelp();
    process.exit(1);
  }

  const { IndexStore } = require('./packages/core/dist/search/index.js');
  const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
  const { loadConfig } = require('./packages/core/dist/config/index.js');

  console.log('🔍 项目代码查询\n');
  console.log(`问题: "${options.query}"`);
  console.log(`项目: ${options.project}`);
  console.log(`检索数量: ${options.topK}`);
  console.log(`文件类型: ${options.fileTypes.join(', ')}`);
  if (options.codeTypes) {
    console.log(`代码类型: ${options.codeTypes.join(', ')}`);
  }
  console.log('');

  const config = await loadConfig();
  const project = config.projects.find(p => p.name === options.project);

  if (!project) {
    console.error(`❌ 没有找到项目: ${options.project}`);
    console.log('\n可用项目:');
    config.projects.forEach(p => console.log(`  - ${p.name}`));
    process.exit(1);
  }

  console.log(`📦 项目: ${project.name}`);
  console.log(`📂 路径: ${project.path}`);
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

  console.log('📝 步骤 1: 智能向量检索...');
  const searchOptions = {
    limit: options.topK,
    projects: [options.project],
    fileTypes: options.fileTypes,
  };

  if (options.codeTypes) {
    searchOptions.codeTypes = options.codeTypes;
  }

  const results = await indexStore.smartSearch(options.query, searchOptions);
  console.log(`✓ 找到 ${results.length} 个相关代码片段\n`);

  if (results.length === 0) {
    console.log('❌ 没有找到相关代码');
    return;
  }

  if (!options.useLLM && !options.showCode) {
    console.log('\n📋 搜索结果:\n');
    results.forEach((result, idx) => {
      const keywordInfo = result.keywordMatches?.length > 0
        ? ` - 关键词: ${result.keywordMatches.join(', ')}`
        : '';
      console.log(`${idx + 1}. ${result.name} (${result.type})`);
      console.log(`   相似度: ${(1 / (1 + result.score)).toFixed(4)}${keywordInfo}`);
      console.log(`   位置: ${result.filePath.replace(project.path, '')}:${result.startLine}-${result.endLine}`);
      console.log('');
    });
    console.log('✅ 查询完成！');
    return;
  }

  console.log('📖 步骤 2: 读取文件内容...');
  const codeContext = [];
  const displayCount = Math.min(results.length, options.useLLM ? 5 : 10);

  for (const result of results.slice(0, displayCount)) {
    try {
      const keywordInfo = result.keywordMatches?.length > 0
        ? ` - 关键词: ${result.keywordMatches.join(', ')}`
        : '';
      console.log(`  ✓ ${result.name} (${result.type}) - 相似度: ${(1 / (1 + result.score)).toFixed(4)}${keywordInfo}`);
      console.log(`    位置: ${result.filePath.replace(project.path, '')}:${result.startLine}-${result.endLine}`);

      if (options.showCode || options.useLLM) {
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
      }
    } catch (err) {
      console.log(`  ⚠️  无法读取: ${result.name}`);
    }
  }

  if (!options.useLLM) {
    console.log('\n📋 代码片段:\n');
    codeContext.forEach((ctx, idx) => {
      console.log(`### ${idx + 1}. ${ctx.name} (${ctx.type})`);
      console.log(`位置: ${ctx.file}:${ctx.startLine}-${ctx.endLine}`);
      console.log(`相似度: ${ctx.similarity}`);
      if (ctx.keywords.length > 0) {
        console.log(`关键词: ${ctx.keywords.join(', ')}`);
      }
      console.log('```javascript');
      console.log(ctx.content);
      console.log('```\n');
    });
    console.log('✅ 查询完成！');
    return;
  }

  console.log('\n🤖 步骤 3: LLM 推理分析...\n');

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
      content: `问题: ${options.query}\n\n以下是通过向量检索找到的相关代码:\n\n${contextText}\n\n请基于以上代码，详细回答问题。如果代码中有具体的实现逻辑，请说明关键步骤和文件位置。`
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
