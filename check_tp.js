const fs = require('fs');
const path = require('path');
const indexDtsPath = path.join(__dirname, 'node_modules', 'react-native-track-player', 'lib', 'index.d.ts');
if (fs.existsSync(indexDtsPath)) {
  const content = fs.readFileSync(indexDtsPath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('move')) {
      console.log(`Line ${i}: ${line}`);
    }
  });
} else {
  console.error('index.d.ts not found. Did you install react-native-track-player?');
  // Fallback: search in any .d.ts files under the module
  const moduleDir = path.join(__dirname, 'node_modules', 'react-native-track-player');
  if (fs.existsSync(moduleDir)) {
    const files = fs.readdirSync(moduleDir, { recursive: true });
    console.log('Files in react-native-track-player:', files);
  } else {
    console.error('react-native-track-player directory not found in node_modules.');
    console.error('Current node_modules content (first 30 entries):');
    const nm = path.join(__dirname, 'node_modules');
    if (fs.existsSync(nm)) {
      const entries = fs.readdirSync(nm).slice(0, 30);
      console.log(entries);
    }
  }
}
