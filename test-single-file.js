const path = require('path');
const fs = require('fs');

async function testSingleFile() {
  const { parseFile } = require('./packages/core/dist/parser/index.js');
  
  // 测试一个简单的 Vue 文件
  const testFile = {
    path: '/Users/wangguangduo/faiscoApp/codebase/projects/mallsite-res/js/src/components/HelloWorld.vue',
    relativePath: 'src/components/HelloWorld.vue',
    extension: '.vue',
    size: 1000
  };
  
  try {
    console.log('测试文件:', testFile.path);
    console.log('文件是否存在:', fs.existsSync(testFile.path));
    
    const units = await parseFile(testFile, 'mallsite-res');
    console.log('解析成功! 生成了', units.length, '个 units');
    console.log('Units:', JSON.stringify(units, null, 2));
  } catch (error) {
    console.error('解析失败:', error.message);
    console.error('错误堆栈:', error.stack);
  }
}

testSingleFile();
