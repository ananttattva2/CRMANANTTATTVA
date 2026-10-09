const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/arCompliance');
const Client = require('../src/models/Client');
const Annual = require('../src/models/AnnualReturn');
const Purchase = require('../src/models/PurchaseData');
const Sales = require('../src/models/SalesData');
const PR = require('../src/models/PurchaseImportRow');
const SR = require('../src/models/SalesImportRow');
const Review = require('../src/models/ArComplianceReview');
const cc = require('../src/controllers/clientController');
const ctrl = require('../src/controllers/arComplianceController');
const id = '64b000000000000000000002',
  manager = {
    _id: '64b000000000000000000001',
    role: 'manager',
    name: 'Manager'
  },
  compliance = {
    ...manager,
    role: 'compliance',
    name: 'Compliance'
  };
const q = value => ({
  populate() {
    return this;
  },
  select() {
    return this;
  },
  sort() {
    return this;
  },
  async lean() {
    return structuredClone(value);
  }
});
const res = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});
const upload = name => ({
  importStatus: 'Imported',
  name,
  importedRowCount: 1,
  totalQuantity: 12
});
function inputs() {
  return {
    draft: {
      'basic.gstNumber': 'GST123',
      'data.productionFacility': false
    },
    purchase: {
      clientId: id,
      financialYear: '2025-26',
      dataVersion: 1,
      baseUpload: upload('base.xlsx'),
      portalUpload: upload('portal.xlsx'),
      checklist: [{
        particular: 'Received from client',
        status: 'Yes',
        files: [{
          name: 'proof.pdf',
          url: 'https://example.test/proof.pdf'
        }]
      }],
      reconciliation: {
        totals: {
          baseQty: 12,
          portalQty: 12
        },
        categorySummary: {
          'Cat-I': {
            Registered: {
              baseQty: 12
            }
          }
        },
        entitySummary: {
          Registered: [{
            name: 'Factory',
            baseQty: 12
          }]
        }
      }
    },
    purchaseRows: [{
      source: 'base',
      rowNumber: 1,
      entityName: 'Factory',
      quantity: 12
    }, {
      source: 'portal',
      rowNumber: 1,
      entityName: 'Factory',
      quantity: 12
    }]
  };
}
const verified = sections => sections.flatMap(s => s.fields).map(f => ({
  key: f.key,
  fingerprint: f.fingerprint,
  status: 'VERIFIED',
  remarks: 'Checked'
}));
function fixture(t) {
  const data = inputs(),
    client = {
      _id: id,
      data: {
        basic: {
          clientLegalName: 'Test Client'
        },
        annualReturn: {
          filings: {
            '2025-26': {
              draft: data.draft
            }
          }
        }
      }
    },
    state = {
      review: null,
      writes: [],
      data,
      client
    };
  t.mock.method(cc, 'clientAccessFilter', async () => ({
    managerScoped: true
  }));
  t.mock.method(Client, 'findOne', () => q(client));
  t.mock.method(Client, 'find', () => q([client]));
  t.mock.method(Annual, 'find', () => q([]));
  for (const [model, value] of [[Purchase, data.purchase], [Sales, null]]) {
    t.mock.method(model, 'findOne', () => q(value));
    t.mock.method(model, 'find', () => q(service.readyModule(value) ? [value] : []));
  }
  t.mock.method(PR, 'find', () => q(data.purchaseRows));
  t.mock.method(SR, 'find', () => q([]));
  t.mock.method(Review, 'findOne', () => q(state.review));
  t.mock.method(Review, 'find', () => q(state.review ? [state.review] : []));
  t.mock.method(Review, 'updateOne', async (filter, update) => {
    state.writes.push({
      filter,
      update
    });
    state.review ||= {
      client: id,
      financialYear: '2025-26',
      fields: [],
      managerFields: [],
      history: []
    };
    if (Array.isArray(update)) {
      const values = update[0].$set,
        path = values.managerFields ? 'managerFields' : 'fields',
        item = values[path].$concatArrays[1].$literal[0];
      state.review[path] = (state.review[path] || []).filter(f => f.key !== item.key).concat(item);
      for (const [key, value] of Object.entries(values)) if (![path, 'history'].includes(key)) state.review[key] = value;
    } else if (update.$set) Object.assign(state.review, update.$set);
    state.review.updatedAt = new Date();
    return {
      matchedCount: 1
    };
  });
  return state;
}
async function call(method, user = manager, body = {}) {
  const response = res();
  await ctrl[method]({
    params: {
      id
    },
    query: {
      financialYear: '2025-26'
    },
    user,
    body: {
      financialYear: '2025-26',
      ...body
    }
  }, response, error => {
    throw error;
  });
  return response;
}
test('draft, one-file and failed imports do not qualify for AR review', () => {
  assert.equal(service.readyModule(null), false);
  assert.equal(service.readyModule({
    baseUpload: upload('base')
  }), false);
  assert.equal(service.readyModule({
    baseUpload: upload('base'),
    portalUpload: {
      importStatus: 'Failed'
    }
  }), false);
  assert.deepEqual(service.buildSections({
    draft: {
      name: 'draft'
    }
  }), []);
});
test('summary, tracker files and entities display as complete read-only table units', () => {
  const data = inputs(),
    copy = structuredClone(data),
    sections = service.buildSections(data),
    purchase = sections.find(s => s.key === 'purchase');
  assert.deepEqual(data, copy);
  assert.equal(purchase.fields.find(f => f.label === 'Purchase Base Excel Table').rows[0].entityName, 'Factory');
  assert.equal(purchase.fields.find(f => f.label === 'Purchase Upload Tracker').rows[0].files[0].name, 'proof.pdf');
  assert.equal(purchase.fields.find(f => f.kind === 'summary').categories['Cat-I'].Registered.baseQty, 12);
  assert.equal(purchase.fields.find(f => f.label === 'Registered Entity List').rows[0].name, 'Factory');
  assert.ok(!purchase.fields.some(f => /Row 1/.test(f.label)));
});
test('email proof IDs stay strings for protected preview and download requests', () => {
  const mongoose = require('mongoose');
  const data = inputs();
  const proofId = new mongoose.Types.ObjectId();
  data.purchase.checklist[0].files = [{ proofId, name: 'Confirmation.msg', type: 'application/vnd.ms-outlook', url: `/api/purchase-proofs/${proofId}/download` }];
  const proof = service.buildSections(data).find(section => section.key === 'purchase').fields.find(field => field.kind === 'tracker').rows[0].files[0];
  assert.equal(proof.proofId, proofId.toHexString());
  assert.equal(proof.url, `/api/purchase-proofs/${proofId}/download`);
});
test('extra imported rows need no extra cell reviews; change invalidates its whole table', () => {
  const data = inputs(),
    sections = service.buildSections(data),
    total = sections.flatMap(s => s.fields).length;
  data.purchaseRows.push({
    source: 'base',
    rowNumber: 2,
    entityName: 'Other',
    quantity: 0
  });
  const changed = service.reviewState(service.buildSections(data), {
    fields: verified(sections)
  });
  assert.equal(changed.progress.total, total);
  assert.equal(changed.progress.verified, total - 1);
  assert.equal(changed.sections.find(s => s.key === 'purchase').fields.find(f => f.label === 'Purchase Base Excel Table').review.stale, true);
});
test('Manager approval gates Compliance and data changes reset both stages', () => {
  const fp = service.reviewState(service.buildSections(inputs())).sourceFingerprint;
  assert.equal(service.workflowState({}, fp).stage, 'MANAGER_REVIEW');
  assert.equal(service.workflowState({
    managerStatus: 'REJECTED',
    managerSourceFingerprint: fp
  }, fp).stage, 'MANAGER_REJECTED');
  const review = {
    managerStatus: 'APPROVED',
    managerSourceFingerprint: fp,
    status: 'APPROVED',
    sourceFingerprint: fp
  };
  assert.equal(service.workflowState(review, fp).stage, 'COMPLETED');
  assert.equal(service.workflowState(review, 'changed').stage, 'MANAGER_REVIEW');
});
test('one final review requires remarks and available data, not individual reviews', () => {
  const state = {
    progress: {
      total: 12,
      reviewed: 0,
      verified: 0
    }
  };
  assert.equal(service.validateDecision('APPROVED', 'Reviewed all AR data', state, 'manager'), '');
  assert.equal(service.validateDecision('REJECTED', 'Corrections needed', state, 'manager'), '');
  assert.match(service.validateDecision('PARTIALLY_APPROVED', 'Reason', state, 'manager'), /Manager/);
  assert.equal(service.validateDecision('PARTIALLY_APPROVED', 'Some data needs correction', state), '');
  assert.match(service.validateDecision('APPROVED', '', state), /remarks/);
  assert.match(service.validateDecision('APPROVED', 'Reason', {
    progress: {
      total: 0
    }
  }), /No annual/);
});
test('Manager and Compliance submit one final review without any individual field writes', async t => {
  const state = fixture(t);
  const original = structuredClone(state.data);
  const initial = (await call('get', manager)).body;
  assert.equal(initial.progress.reviewed, 0);
  const approved = await call('decide', manager, {
    reviewStage: 'manager',
    sourceFingerprint: initial.sourceFingerprint,
    decision: 'APPROVED',
    remarks: 'Reviewed complete tracker and both Excel uploads'
  });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.workflow.stage, 'COMPLIANCE_REVIEW');
  const next = (await call('get', compliance)).body;
  const partial = await call('decide', compliance, {
    reviewStage: 'compliance',
    sourceFingerprint: next.sourceFingerprint,
    decision: 'PARTIALLY_APPROVED',
    remarks: 'Reconciliation differences require correction'
  });
  assert.equal(partial.statusCode, 200);
  assert.equal(partial.body.status, 'PARTIALLY_APPROVED');
  assert.equal(state.review.fields.length, 0);
  assert.equal(state.review.managerFields.length, 0);
  assert.deepEqual(state.data, original);
  assert.ok(state.writes.every(write => !Array.isArray(write.update)));
});
test('queue contains completed Excel pairs only and shows initial Manager stage', async t => {
  const state = fixture(t);
  let result = await call('list');
  assert.equal(result.body.rows.length, 1);
  assert.equal(result.body.rows[0].stage, 'MANAGER_REVIEW');
  state.data.purchase.portalUpload = null;
  result = await call('list');
  assert.equal(result.body.rows.length, 0);
});
test('Compliance cannot save reviews or final decision before Manager approves', async t => {
  const state = fixture(t),
    data = (await call('get', compliance)).body;
  assert.equal(data.canReview, false);
  assert.equal(data.workflow.stage, 'MANAGER_REVIEW');
  assert.equal((await call('saveField', compliance, {
    reviewStage: 'compliance'
  })).statusCode, 403);
  assert.equal((await call('decide', compliance, {
    reviewStage: 'compliance'
  })).statusCode, 403);
  assert.equal(state.writes.length, 0);
});
test('Manager review persists separately and never changes user values', async t => {
  const state = fixture(t),
    data = (await call('get')).body,
    field = data.sections.find(s => s.key === 'purchase').fields[0];
  t.mock.method(Client, 'updateOne', () => {
    throw Error('User data must not change');
  });
  t.mock.method(Purchase, 'updateOne', () => {
    throw Error('Excel data must not change');
  });
  const result = await call('saveField', manager, {
    reviewStage: 'manager',
    key: field.key,
    fingerprint: field.fingerprint,
    status: 'VERIFIED',
    remarks: 'Tracker checked',
    data: {
      status: 'tampered'
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(state.review.managerFields.length, 1);
  assert.equal(state.review.fields.length, 0);
  assert.equal(state.data.purchase.checklist[0].status, 'Yes');
});
test('Manager access is scoped to accessible clients', async t => {
  fixture(t);
  let filter;
  t.mock.method(Client, 'findOne', value => {
    filter = value;
    return q(null);
  });
  assert.equal((await call('get')).statusCode, 404);
  assert.deepEqual(filter.$and[1], {
    managerScoped: true
  });
});
test('Manager Reject blocks handoff; Approve unlocks independent Compliance reviews', async t => {
  const state = fixture(t),
    data = (await call('get')).body;
  state.review = {
    client: id,
    financialYear: '2025-26',
    managerFields: verified(data.sections),
    fields: [],
    updatedAt: new Date()
  };
  let result = await call('decide', manager, {
    reviewStage: 'manager',
    sourceFingerprint: data.sourceFingerprint,
    decision: 'REJECTED',
    remarks: 'Please correct'
  });
  assert.equal(result.body.workflow.stage, 'MANAGER_REJECTED');
  assert.equal((await call('get', compliance)).body.canReview, false);
  result = await call('decide', manager, {
    reviewStage: 'manager',
    sourceFingerprint: data.sourceFingerprint,
    decision: 'APPROVED',
    remarks: 'All checked'
  });
  assert.equal(result.body.workflow.stage, 'COMPLIANCE_REVIEW');
  const next = (await call('get', compliance)).body;
  assert.equal(next.canReview, true);
  assert.equal(next.progress.reviewed, 0);
  assert.equal(next.managerDecision.by, 'Manager');
  assert.equal((await call('get', manager)).body.canReview, false);
});
test('changed source returns queue to Manager and blocks Compliance', async t => {
  const state = fixture(t),
    data = (await call('get')).body;
  state.review = {
    client: id,
    financialYear: '2025-26',
    managerStatus: 'APPROVED',
    managerSourceFingerprint: data.sourceFingerprint,
    managerSourceRevision: service.sourceRevision(state.data),
    fields: [],
    managerFields: []
  };
  assert.equal((await call('list', compliance)).body.rows[0].stage, 'COMPLIANCE_REVIEW');
  state.data.purchase.checklist[0].status = 'No';
  assert.equal((await call('list', compliance)).body.rows[0].stage, 'MANAGER_REVIEW');
  assert.equal((await call('get', compliance)).body.canReview, false);
});
test('Compliance final approval persists after its own table reviews', async t => {
  const state = fixture(t),
    data = (await call('get')).body;
  state.review = {
    client: id,
    financialYear: '2025-26',
    managerStatus: 'APPROVED',
    managerSourceFingerprint: data.sourceFingerprint,
    managerSourceRevision: service.sourceRevision(state.data),
    fields: verified(data.sections),
    updatedAt: new Date()
  };
  const result = await call('decide', compliance, {
    reviewStage: 'compliance',
    sourceFingerprint: data.sourceFingerprint,
    decision: 'APPROVED',
    remarks: 'Compliance verified'
  });
  assert.equal(result.body.workflow.stage, 'COMPLETED');
  assert.equal(state.review.managerStatus, 'APPROVED');
  assert.equal((await call('list', compliance)).body.rows[0].status, 'APPROVED');
});
test('forged stage and stale fingerprints cannot change reviews', async t => {
  const state = fixture(t),
    data = (await call('get')).body;
  assert.equal((await call('saveField', manager, {
    reviewStage: 'compliance'
  })).statusCode, 403);
  assert.equal((await call('saveField', manager, {
    reviewStage: 'manager',
    key: data.sections[0].fields[0].key,
    fingerprint: 'old'
  })).statusCode, 409);
  assert.equal((await call('decide', manager, {
    reviewStage: 'manager',
    sourceFingerprint: 'old'
  })).statusCode, 409);
  assert.equal(state.writes.length, 0);
});
test('AR route permissions allow Manager and Compliance but reject operations', () => {
  const routes = require('../src/routes/clients').stack.filter(l => l.route?.path.includes('ar-compliance'));
  assert.equal(routes.length, 4);
  for (const layer of routes) {
    assert.equal(layer.route.stack[0].handle.name, 'requireAuth');
    for (const role of ['manager', 'compliance', 'compliance manager', 'admin']) {
      let passed = false;
      layer.route.stack[1].handle({
        user: {
          role
        }
      }, res(), () => {
        passed = true;
      });
      assert.equal(passed, true);
    }
    const denied = res();
    layer.route.stack[1].handle({
      user: {
        role: 'operation'
      }
    }, denied, () => {});
    assert.equal(denied.statusCode, 403);
  }
});
