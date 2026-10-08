const fs = require('fs');
const files = fs.readdirSync('server/src/routes');
const backendRoutes = [];
files.forEach(f => {
  const content = fs.readFileSync('server/src/routes/' + f, 'utf8');
  const matches = content.matchAll(/router\.(get|post|patch|delete)\(['"]([^'"]+)['"]/g);
  for (const match of matches) {
    const method = match[1].toUpperCase();
    const route = match[2];
    const prefix = f.replace('.js', '');
    backendRoutes.push(`${method} /api/${prefix}${route === '/' ? '' : route}`);
  }
});
console.log(backendRoutes.join('\n'));
