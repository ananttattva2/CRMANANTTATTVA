const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {transformSync} = require('esbuild');
// Compile the real table in isolation so upload/network modules are not evaluated.
const source = fs.readFileSync(path.resolve(__dirname,'../src/features/clientMaster/ClientMasterFormSections.jsx'),'utf8');
const table = source.slice(source.indexOf('function PlantQuantityTable('),source.indexOf('function CteTab('));
const input = source.slice(source.indexOf('function TableInput('),source.indexOf('function TableUpload('));
const code = `const React=require('react'); const {useState}=React; const {splitProductQuantity,needsPieceWeight,formatMtPerYear}=require('../../shared/productQuantity.cjs'); const Plus=()=>null; ${input} ${table} module.exports=PlantQuantityTable;`;
const compiled = new Module(__filename,module);
compiled.filename=__filename;
compiled.paths=module.paths;
compiled._compile(transformSync(code,{loader:'jsx',format:'cjs'}).code,__filename);
const Table=compiled.exports;
const columns=[['productName','Product'],['quantity','Quantity'],['uom','UOM'],['period','Month/Year'],['pieceWeight','Per Piece Weight'],['pieceWeightUom','PPW UOM'],['mtPerYear','MT per Year']];
function render(row) {
 return renderToStaticMarkup(React.createElement(Table,{title:'CTO/CCA Product Quantity',plants:[{plantName:'Plant',ctoProductRows:[row]}],quantityKey:'ctoProductRows',columns,rowTemplate:{},onAddRow(){},onUpdateRow(){},onRemoveRow(){},onPlantNameChange(){}}));
}
test('piece UOM enables numeric weight and kg/g dropdown with read-only annual result',()=>{
 const html=render({productName:'Cup',quantity:'17000000',uom:'nos',period:'month',pieceWeight:'5',pieceWeightUom:'g'});
 assert.match(html,/<input[^>]*type="number"[^>]*aria-label="pieceWeight row 1"[^>]*value="5"/);
 assert.match(html,/<select aria-label="PPW UOM row 1" class=/);
 assert.match(html,/<option value="g" selected="">g<\/option>/);
 assert.match(html,/<output[^>]*>1020<\/output>/);
 assert.ok(!html.includes('aria-label="mtPerYear'));
});
test('KG and MT disable both piece controls and calculate directly',()=>{
 for(const [uom,expected] of [['KG','72'],['MT','72000']]) {
  const html=render({quantity:'6000',uom,period:'month',pieceWeight:'999',pieceWeightUom:'g'});
  assert.match(html,/<input[^>]*aria-label="pieceWeight row 1"[^>]*disabled=""/);
  assert.match(html,/<select aria-label="PPW UOM row 1" disabled=""/);
  assert.ok(html.includes('>'+expected+'</output>'));
 }
});
test('missing weight shows an empty result and input changes recalculate annual MT',()=>{
 const row={quantity:'100',uom:'nos',period:'year',pieceWeightUom:'kg'};
 assert.match(render(row),/<output[^>]*>—<\/output>/);
 assert.match(render({...row,pieceWeight:'2'}),/<output[^>]*>0.2<\/output>/);
 assert.match(render({...row,pieceWeight:'2',period:'month'}),/<output[^>]*>2.4<\/output>/);
});
