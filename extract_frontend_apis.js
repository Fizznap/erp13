const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      results.push(file);
    }
  });
  return results;
}

const files = walk('client/src').filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
const frontendCalls = [];
files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.matchAll(/api(?:<[^>]+>)?\(['"`]([^'"`]+)['"`]/g);
  for (const match of matches) {
    frontendCalls.push(match[1]);
  }
});
console.log([...new Set(frontendCalls)].join('\n'));
