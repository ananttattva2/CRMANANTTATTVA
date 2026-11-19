const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Other User lead ownership is persisted separately from the actual creator', () => {
  const model = fs.readFileSync(path.resolve(__dirname, '../src/models/Lead.js'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  assert.match(model, /generatedForUser: \{ type: mongoose\.Schema\.Types\.ObjectId, ref: 'User'/);
  assert.match(controller, /'generatedForUser'/);
  assert.match(page, /generatedForUser: generatedForOwnerId/);
  assert.match(page, /createdByCrmUserId: index < frozenServiceRowCount/);
  assert.match(page, /String\(actualCreatorId\)/);
  assert.match(controller, /createdBy: user\?\._id/);
  assert.match(controller, /populate\('generatedForUser', 'name email'\)/);
});

test('Lead staff filter uses Sales MIS creator ownership with assignment fallback', () => {
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  assert.match(controller, /populate\('generatedForUser', 'name email crmUserId'\)/);
  assert.match(page, /function leadStaffIdentityTokens/);
  assert.match(page, /const creatorTokens = personIdentityTokens/);
  assert.match(page, /if \(creatorTokens\.length\) return creatorTokens/);
  assert.match(page, /item\.generatedForUser, item\.generatedForName, item\.generatedForEmail/);
  assert.match(page, /Array\.isArray\(item\.assignments\)/);
  assert.match(page, /Array\.isArray\(item\.serviceSelections\)/);
  assert.match(page, /return \[\.\.\.new Set\(fallbackTokens\)\]/);
  assert.match(page, /assignment\.assignedStaff, assignment\.assignedStaffText, assignment\.assignedStaffEmail/);
});

test('actual creator and generated-for owner can both quote lead services', () => {
  const quotationPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  const leadPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  const quotationController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/quotationController.js'), 'utf8');
  assert.match(quotationPage, /lead\.generatedForUser\?\._id/);
  assert.match(quotationPage, /lead\.generatedForName/);
  assert.match(quotationPage, /participantTokens\.some\(\(token\) => userTokens\.includes\(token\)\)/);
  assert.match(leadPage, /const participantCanSeeAllServices =/);
  assert.match(leadPage, /viewLead\.generatedForUser\?\._id/);
  assert.match(leadPage, /if \(participantCanSeeAllServices\) return true/);
  assert.match(quotationController, /'generatedForName', 'generatedForEmail'/);
  assert.match(quotationController, /'generatedForUser'/);
  assert.match(quotationController, /'assignedStaff'/);
});

test('allocated owner can edit the lead without ownership being overwritten', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
  assert.match(page, /function canUserEditLead\(item = \{\}, currentUser = \{\}\)/);
  assert.match(page, /item\.generatedForUser, item\.generatedForName, item\.generatedForEmail/);
  assert.match(page, /canUserEditLead\(item, currentUser\)/);
  assert.match(page, /canEdit=\{canUserEditLead\(viewLead, currentUser\)\}/);
  assert.match(page, /setGeneratedForUserId\(String\(ownerId\)\)/);
  assert.match(page, /setGeneratedForConfirmed\(true\)/);
  assert.match(controller, /beforeLead\.generatedForUser, beforeLead\.generatedForName, beforeLead\.generatedForEmail/);
});
