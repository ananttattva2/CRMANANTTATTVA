const fs=require('fs'),path=require('path'),parser=require('../frontend/node_modules/@babel/parser');
const root=path.resolve('frontend/src');
const files=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())walk(name);else if(/\.(jsx|mjs|js)$/.test(name))files.push(name)}}walk(root);
const skip=new Set(['Quotations.jsx','dataExport.js','OutlookMsgViewer.jsx','DocumentsLibrary.jsx','InternalTickets.jsx','Notifications.jsx']);
for(const file of files){if(skip.has(path.basename(file)))continue;let source=fs.readFileSync(file,'utf8');const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});let edits=[],asyncFns=new Set();
function visit(node,anc=[]){if(!node||typeof node!=='object')return;
 if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'){
 const obj=node.callee.object,prop=node.callee.property.name;
 const isSheet=prop==='writeFile'&&obj.name==='XLSX';
 const isPdf=prop==='save'&&['pdf','doc'].includes(obj.name);
 const isClick=prop==='click'&&['link','anchor'].includes(obj.name);
 const isPrint=prop==='print'&&obj.name==='window';
 if(isSheet||isPdf||isClick||isPrint){const fn=[...anc].reverse().find(n=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type));if(!fn)throw Error(file+' no function');
 let filename=isSheet?source.slice(node.arguments[1].start,node.arguments[1].end):isPdf?source.slice(node.arguments[0].start,node.arguments[0].end):isClick?`${obj.name}.download`:`'Print / PDF'`;
 if(!filename.includes('template')){
 edits.push({start:node.start,end:node.end,value:`await exportWithReason(${filename}, () => ${source.slice(node.start,node.end)})`});
 if(!fn.async)asyncFns.add(fn.start);
 const name=fn.id?.name||source.slice(fn.start,fn.start+60).split('\n')[0];console.log(path.relative(root,file)+': '+name);
 }
 }
 }
 for(const [key,value] of Object.entries(node)){if(['start','end','loc','extra'].includes(key))continue;if(Array.isArray(value))value.forEach(n=>visit(n,[...anc,node]));else if(value&&typeof value==='object')visit(value,[...anc,node]);}
}visit(ast);
if(edits.length){for(const at of asyncFns)edits.push({start:at,end:at,value:'async '});edits.sort((a,b)=>b.start-a.start);for(const e of edits)source=source.slice(0,e.start)+e.value+source.slice(e.end);
let rel=path.relative(path.dirname(file),path.join(root,'utils/dataExport')).replaceAll('\\','/');if(!rel.startsWith('.'))rel='./'+rel;
source=`import { exportWithReason } from '${rel}'\n`+source;parser.parse(source,{sourceType:'module',plugins:['jsx']});fs.writeFileSync(file,source);}
}
