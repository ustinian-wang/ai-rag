const fs = require('fs');
const { parseFile } = require('./packages/core/dist/parser/index.js');

async function testParse() {
  // 测试一个简单的 JS 文件
  const testFile = {
    path: '/Users/wangguangduo/faiscoApp/codebase/projects/mallsite-res/js/babel.config.js',
    relativePath: 'babel.config.js',
    extension: '.js',
    size: 214
  };
  
  console.log('测试文件:', testFile.path);
  console.log('文件是否存在:', fs.existsSync(testFile.path));
  
  if (fs.existsSync(testFile.path)) {
    console.log('文件内容:');
    console.log(fs.readFileSync(testFile.path, 'utf-8'));
  }
  
  try {
    const units = await parseFile(testFile, 'mallsite-res');
    console.log('\n解析成功! 生成了', units.length, '个 units');
    if (units.length > 0) {
      console.log('第一个 unit:', JSON.stringify(units[0], null, 2));
    }
  } catch (error) {
    console.error('\n解析失败:', error.message);
    console.error('错误堆栈:', error.stack);
  }
}

testParse();
