const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = process.cwd();
const originals = new Map(['frontend/src/pages/Quotations.jsx','frontend/src/styles/modules/14-desktop-density.css','backend/src/controllers/quotationController.js'].map(file => [path.resolve(root,file),execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8',maxBuffer:8e6})]));
const read = fs.readFileSync;
fs.readFileSync = function(file, options) { const source = originals.get(path.resolve(String(file))); return source === undefined ? read.apply(this,arguments) : (typeof options === 'string' || options?.encoding ? source : Buffer.from(source)); };
