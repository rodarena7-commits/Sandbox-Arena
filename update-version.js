// update-version.js - Script para actualizar versiones
const fs = require('fs');
const path = require('path');

const incrementVersion = (version) => {
  const parts = version.split('.');
  const minor = parseInt(parts[2]) + 1;
  return `${parts[0]}.${parts[1]}.${minor}`;
};

const updateFile = (filePath, oldVersion, newVersion) => {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Actualizar todas las apariciones de la versión
  const regex = new RegExp(oldVersion.replace(/\./g, '\\.'), 'g');
  content = content.replace(regex, newVersion);
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✓ ${filePath} actualizado a v${newVersion}`);
};

// Leer versión actual desde package.json
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const currentVersion = packageJson.version;
const newVersion = incrementVersion(currentVersion);

// Actualizar package.json
packageJson.version = newVersion;
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

console.log(`\nActualizando de v${currentVersion} a v${newVersion}\n`);

// Actualizar archivos
updateFile('public/sw.js', currentVersion, newVersion);
updateFile('src/App.jsx', currentVersion, newVersion);
updateFile('public/manifest.json', currentVersion, newVersion);

console.log('\n✅ Versión actualizada exitosamente!');
