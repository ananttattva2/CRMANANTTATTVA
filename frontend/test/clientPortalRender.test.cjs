const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const file = path.join(__dirname, '../src/components/clientPortal/ClientPortalInfo.jsx');
const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'lucide-react'] }).outputFiles[0].text;
const compiled = new Module(path.join(__dirname, 'portal-ui-render.cjs'));
compiled.filename = path.join(__dirname, 'portal-ui-render.cjs');
compiled.paths = Module._nodeModulePaths(__dirname);
compiled._compile(code, compiled.filename);
const { default: Info, InfoGrid, ComplianceFields } = compiled.exports;
test('company info renders compact labelled profile and clear navigation instead of a raw object dump', () => {
 const client={_id:'1',company:'Example Company',leadCode:'LEAD-001',city:'Mumbai',state:'Maharashtra',addressLine1:'212 Industrial Area',contacts:[{contactPerson:'Example Contact',designation:'Manager',emails:'client@example.com',mobileNo1:'9000000000'}],clientMaster:[{basic:{clientLegalName:'Example Company'},compliance:{gstNumber:'GST123',gstFile:{name:'gst.pdf',url:'https://example.com/private-file?signature=TEST_METADATA'}}}]};
 const Section=({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children);
 const html=renderToStaticMarkup(React.createElement(Info,{client,Section,Table:()=>null}));
 for(const text of ['Example Company','Company overview','Contacts &amp; locations','Services &amp; SPOC','Registration &amp; compliance','Documents (1)','GST123','Example Contact'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('TEST_METADATA'));
 assert.ok(!html.includes('[object Object]'));
 assert.ok(!html.includes('Resource Type'));
});
test('profile grid omits absent values without rendering empty placeholder rows',()=>{
 const html=renderToStaticMarkup(React.createElement(InfoGrid,{rows:[{label:'Company',value:'Example'},{label:'Empty value',value:''},{label:'Missing',value:null}]}));
 assert.ok(html.includes('Example'));
 assert.ok(!html.includes('Empty value'));
 assert.ok(!html.includes('Missing'));
});


test('repeated production data renders as product rows instead of a long concatenated value',()=>{
 let received;
 const Table=props=>{received=props;return React.createElement('table',null,React.createElement('tbody',null,props.rows.map((row,index)=>React.createElement('tr',{key:index},Object.values(row).map((value,index)=>React.createElement('td',{key:index},value))))));};
 const html=renderToStaticMarkup(React.createElement(ComplianceFields,{Table,fields:[{label:'Product Name',group:'Plant / 1 / CTO Products / 1',value:'Process water'},{label:'Quantity',group:'Plant / 1 / CTO Products / 1',value:'380'},{label:'Product Name',group:'Plant / 1 / CTO Products / 2',value:'Cooling'},{label:'Quantity',group:'Plant / 1 / CTO Products / 2',value:'40'}]}));
 assert.equal(received.rows.length,2);
 assert.equal(received.columns.length,2);
 assert.ok(html.includes('<table>'));
 assert.ok(html.includes('Process water'));
});


test('services tab shows assigned user contact number next to the name',()=>{
 const client={company:'Example',clientMaster:[],contacts:[],services:[],assignments:[{spoc:{name:'Account Manager',email:'manager@example.com',contactNumber:'+91 98765 43210'}}]};
 const Section=({title,children})=>React.createElement('section',null,React.createElement('h2',null,title),children);
 const html=renderToStaticMarkup(React.createElement(Info,{client,initialTab:'services',Section,Table:()=>null}));
 assert.ok(html.includes('Account Manager'));
 assert.ok(html.includes('tel:+919876543210'));
 assert.ok(html.includes('+91 98765 43210'));
});
