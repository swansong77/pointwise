// Copies the canonical schema (../database/schema.prisma) into prisma/ so the backend is self-contained
// for Docker builds. Run after editing the canonical schema.
const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '../../database/schema.prisma');
const dst = path.resolve(__dirname, '../prisma/schema.prisma');
if (!fs.existsSync(src)) { console.log('canonical schema not found; keeping', dst); process.exit(0); }
fs.copyFileSync(src, dst);
console.log('synced', src, '->', dst);
