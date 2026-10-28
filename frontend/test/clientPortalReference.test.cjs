const test = require('node:test');

const assert = require('node:assert/strict');

const path = require('node:path');

const Module = require('node:module');

const React = require('react');

const {renderToStaticMarkup}=require('react-dom/server');

const {MemoryRouter}=require('react-router-dom');

const {buildSync}=require('esbuild');

const filename=path.join(__dirname,'reference-client-portal-render.cjs');

const code=buildSync({entryPoints:[path.join(__dirname,'../src/pages/ClientPortal.jsx')],bundle:true,platform:'node',format:'cjs',write:false,external:['react','react-dom','react-router-dom','lucide-react','axios','jspdf'],loader:{'.css':'empty'},define:{'import.meta.env':'{}'}}).outputFiles[0].text;

const compiled=new Module(filename);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(__dirname);compiled._compile(code,filename);

test('client login renders reference welcome form and keeps email-only entry without OTP',()=>{

 const html=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(compiled.exports.ClientLogin)));

 for(const value of ['Welcome back','Open Dashboard','Contact email','All your documents','Dedicated support','Contact support'])assert.ok(html.includes(value),value);

 assert.ok(!html.includes('one-time-code'));
 assert.ok(!html.includes('Staff Login'));
 assert.ok(!html.includes('cp-staff-login'));

 assert.ok(html.includes('cp-login-illustration'));

});





test('purchase order list renders year filter, search and first page with a bounded row count',()=>{

 const rows=Array.from({length:12},(_,index)=>({poNumber:`ORDER-${String(index+1).padStart(2,'0')}`,financialYear:index%2?'2026-27':'2025-26'}));

 const html=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(compiled.exports.Table,{kind:'po',rows,columns:[{label:'PO',key:'poNumber'}]})));

 assert.ok(html.includes('All financial years'));assert.ok(html.includes('2026-27'));assert.ok(html.includes('Search purchase orders'));

 assert.ok(html.includes('Showing 1–10 of 12 purchase orders'));assert.ok(html.includes('ORDER-10'));assert.ok(!html.includes('ORDER-11'));

});

test('empty invoice list provides a real link to the account team',()=>{

 const html=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(compiled.exports.Table,{kind:'pi',rows:[],columns:[{label:'Document',key:'proformaNumber'}],empty:'No proforma invoices shared yet'})));

 assert.ok(html.includes('No proforma invoices shared yet'));assert.ok(html.includes('/client/info?section=services'));assert.ok(html.includes('Contact account team'));

});

