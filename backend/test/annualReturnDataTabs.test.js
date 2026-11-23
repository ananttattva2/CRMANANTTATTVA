const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/ClientMasterAnnualReturn.jsx'), 'utf8');

test('Annual Return hides Financials from the visible processing flow', () => {
  const labelsBlock = source.match(/export const annualProcessingTabLabels = \{([\s\S]*?)\n\};/)?.[1] || '';
  const processingTabsBlock = source.match(/const processingTabs = \[([\s\S]*?)\n  \];/)?.[1] || '';
  assert.doesNotMatch(labelsBlock, /financials\s*:/);
  assert.doesNotMatch(processingTabsBlock, /id:\s*'financials'/);
  assert.doesNotMatch(processingTabsBlock, /id:\s*'basic'/);
  assert.doesNotMatch(labelsBlock, /basic\s*:/);
  assert.match(source, /useState\('data'\)/);
  assert.match(processingTabsBlock, /id:\s*'data'/);
  assert.match(processingTabsBlock, /id:\s*'cpcbLetter'/);
});

test('Data opens the Purchase Data Compliance workspace without exposing Portal Data', () => {
  assert.doesNotMatch(source, /\{ id: 'portal', label: 'Portal Data' \}/);
  assert.match(source, /\{ id: 'compliance', label: 'Data Compliance' \}/);
  assert.match(source, /useState\('compliance'\)/);
  assert.doesNotMatch(source, /activeDataSubTab === 'portal'/);
  assert.doesNotMatch(source, /createProcessingField\('annual\.portalData', 'Portal Data'/);
  assert.match(source, /Open Client Data Workspace/);
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientDataWorkspace.jsx'), 'utf8');
  assert.match(page, /<PurchaseDataWorkspace/);
  assert.match(source, /financialYear=\$\{encodeURIComponent\(selected\.label\)/);
});
