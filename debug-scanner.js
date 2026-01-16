const { scanDirectory } = require('./packages/core/dist/parser/scanner.js');

async function debugScanner() {
  const projectPath = '/Users/wangguangduo/faiscoApp/codebase/projects/mallsite-res/js';
  
  console.log('扫描目录:', projectPath);
  const files = await scanDirectory(projectPath);
  
  console.log('\n找到', files.length, '个文件');
  console.log('\n前10个文件:');
  files.slice(0, 10).forEach(f => {
    console.log('- 路径:', f.path);
    console.log('  相对路径:', f.relativePath);
    console.log('  扩展名:', f.extension);
    console.log('  大小:', f.size);
    console.log('');
  });
}

debugScanner();
