const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const leadController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
const clientController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/clientController.js'), 'utf8');
const leadPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
const clientPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
const clientDirectory = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/ClientDirectoryView.jsx'), 'utf8');

test('Lead list supports bounded server pagination without changing legacy consumers', () => {
  const list = leadController.slice(leadController.indexOf('exports.listLeads'), leadController.indexOf('exports.getLead'));
  assert.match(list, /req\.query\.paginated === 'true'/);
  assert.match(list, /if \(!paginated\)/);
  assert.match(list, /\.skip\(\(page - 1\) \* limit\)\.limit\(limit\)\.lean\(\)/);
  assert.match(list, /Lead\.countDocuments\(filter\)/);
  assert.match(list, /hasNextPage/);
  assert.doesNotMatch(list, /processExpiredProvisionalClosures/);
  assert.doesNotMatch(list, /lead\.save\(\)/);
});

test('Client list uses an inclusion projection and bounded pagination', () => {
  const list = clientController.slice(clientController.indexOf('exports.listClients'), clientController.indexOf('exports.listClientMasterCatalog'));
  assert.match(list, /req\.query\.paginated === 'true'/);
  assert.match(list, /data\.basic\.clientLegalName/);
  assert.match(list, /data\.registeredAddress\.state/);
  assert.match(list, /\.skip\(\(page - 1\) \* limit\)\.limit\(limit\)\.lean\(\)/);
  assert.match(list, /Client\.countDocuments\(filter\)/);
  assert.doesNotMatch(list.slice(list.indexOf('const projection')), /cpcbScreenshots|processDiagrams|loginPassword|ceprPassword/);
});

test('Lead and Client directories request pages and debounce search', () => {
  assert.match(leadPage, /params: \{ paginated: true, (?:directory: true, )?\.\.\.params \}/);
  assert.match(leadPage, /query\.trim\(\) \? 400 : 0/);
  assert.match(leadPage, /fetchLeadDetail/);
  assert.match(clientPage, /params: \{ paginated: true, (?:directory: true, )?\.\.\.params \}/);
  assert.match(clientDirectory, /query\.trim\(\) \? 400 : 0/);
  assert.match(clientDirectory, /pagination\?\.totalPages/);
});
