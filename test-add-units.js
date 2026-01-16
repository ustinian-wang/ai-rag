const { parseFile } = require('./packages/core/dist/parser/index.js');
const { IndexStore } = require('./packages/core/dist/search/index.js');
const { OllamaClient } = require('./packages/core/dist/vectorizer/ollama.js');
const path = require('path');

async function testAddUnits() {
  const testFile = {
    path: '/Users/wangguangduo/faiscoApp/codebase/projects/mallsite-res/js/babel.config.js',
    relativePath: 'babel.config.js',
    extension: '.js',
    size: 214
  };
  
  console.log('1. 解析文件...');
  const units = await parseFile(testFile, 'mallsite-res');
  console.log('   解析成功，生成了', units.length, '个 units');
  
  console.log('\n2. 初始化 IndexStore...');
  const ollamaClient = new OllamaClient({
    baseUrl: 'http://localhost:11434',
    embeddingModel: 'bge-m3',
  });
  
  const indexStore = new IndexStore(
    path.join(process.cwd(), '.ai-rag-data/lance'),
    ollamaClient
  );
  
  console.log('\n3. 检查 addUnits 方法是否存在...');
  console.log('   addUnits 方法:', typeof indexStore.addUnits);
  console.log('   可用方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(indexStore)));
  
  if (typeof indexStore.addUnits === 'function') {
    console.log('\n4. 调用 addUnits...');
    try {
      await indexStore.addUnits(units);
      console.log('   成功!');
    } catch (error) {
      console.error('   失败:', error.message);
    }
  } else {
    console.log('\n4. addUnits 方法不存在!');
  }
}

testAddUnits().catch(console.error);
