const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Lead Allocate shows stable owner and editable creator in separate columns', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadAllocate.jsx'), 'utf8');
  assert.match(source, /Lead Owner \/ Created For/);
  assert.match(source, /Edit Created By/);
  assert.match(source, /creatorName/);
});

test('management Sales MIS uses the compact infographic and dedicated one-page PDF', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/SuperAdminDashboard.jsx'), 'utf8');
  const exportsSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/utils/productivityReportExports.js'), 'utf8');
  assert.match(page, /SalesMisInfographic/);
  assert.match(page, /Team Comparison/);
  assert.match(page, /Closed Leads by Owner/);
  assert.match(page, /Temporary leads/);
  assert.match(exportsSource, /managementSalesGroups/);
  assert.match(exportsSource, /downloadSalesMisInfographicPdf/);
  assert.match(exportsSource, /TEAM TOTAL/);
  assert.match(page, /buildSalesMisReport/);
  assert.match(page, /Management focus:/);
  assert.match(exportsSource, /'Sales Team', 'Operations Team', 'Management', 'Other Departments'/);
  assert.match(exportsSource, /managementSalesPdfGroups/);
  assert.match(exportsSource, /\['Sales Team', 'Management'\]\.includes\(group\.name\)/);
  assert.match(exportsSource, /!== 'admin'/);
  assert.match(exportsSource, /const pdfRows = grouped\.flatMap/);
  assert.match(exportsSource, /const completeSalesRows = completeSalesGroups\.flatMap/);
});

test('lead ownership PDFs keep Sales and non-Admin Management rows only', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/utils/productivityReportExports.js'), 'utf8');
  const start = source.indexOf('function managementSalesGroups(');
  const end = source.indexOf('export async function downloadCompleteMisPdf', start);
  const rows = [
    { name: 'Sales User', role: 'sales', team: 'Sales', totalLeads: 2 },
    { name: 'Operations User', role: 'operation', team: 'Operations', totalLeads: 3 },
    { name: 'Admin User', role: 'admin', team: 'Management', totalLeads: 4 },
    { name: 'Super Admin User', role: 'superadmin', team: 'Management', totalLeads: 5 },
    { name: 'Other User', role: 'accounts', team: 'Accounts', totalLeads: 6 }
  ];
  const groups = vm.runInNewContext(`${source.slice(start, end)} managementSalesPdfGroups(rows)`, { rows });
  assert.deepEqual(Array.from(groups, (group) => group.name), ['Sales Team', 'Management']);
  assert.deepEqual(Array.from(groups.flatMap((group) => group.members), (row) => row.name), ['Sales User', 'Super Admin User']);
});

test('Lead Allocate can edit Created By without reallocating the stable owner', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadAllocate.jsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/leads.js'), 'utf8');
  assert.match(page, /Edit Created By/);
  assert.match(page, /API_ENDPOINTS\.leads\.creator/);
  assert.match(controller, /exports\.updateLeadCreator/);
  assert.match(controller, /creatorChangeHistory\.push/);
  assert.match(controller, /Lead Owner was not changed/);
  assert.match(routes, /\/:id\/creator/);
});
