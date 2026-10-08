const test = require('node:test');
const assert = require('node:assert/strict');
const {
  eventLabel,
  quotationLifecycleEmailContent
} = require('../src/services/quotationLifecycleEmails');

const quotation = {
  quotationNumber: 'AT/26-27/001',
  companyName: 'Pinnacle Industries Ltd'
};
const actor = { name: 'KRISHNA Yadav', email: 'krishna@example.com' };

test('quotation generation email identifies direct Super Admin approval', () => {
  const content = quotationLifecycleEmailContent({ quotation, event: 'created', actor });
  assert.match(content.subject, /Super Admin Approval Pending/);
  assert.match(content.html, /sent directly to Super Admin/);
  assert.match(content.html, /AT\/26-27\/001/);
});

test('quotation revision email confirms direct Super Admin approval', () => {
  const content = quotationLifecycleEmailContent({ quotation, event: 'revised', actor });
  assert.equal(eventLabel('revised'), 'Revised — Super Admin Approval Pending');
  assert.match(content.html, /Admin approval is not required/);
});

test('quotation decision emails clearly identify approved and rejected status', () => {
  const approved = quotationLifecycleEmailContent({ quotation, event: 'approved', actor });
  const rejected = quotationLifecycleEmailContent({ quotation, event: 'rejected', actor });
  assert.match(approved.subject, /Approved/);
  assert.match(approved.html, /has been approved/);
  assert.match(rejected.subject, /Rejected/);
  assert.match(rejected.html, /has been rejected/);
});

test('admin approval email unlocks the PDF while keeping final approval pending', () => {
  const content = quotationLifecycleEmailContent({ quotation, event: 'admin_approved', actor });
  assert.match(content.subject, /Admin Approved/);
  assert.match(content.html, /PDF is now available/);
  assert.match(content.html, /final Super Admin approval is still pending/);
});

test('quotation rejection email has premium action UI and includes escaped admin notes', () => {
  const rejected = quotationLifecycleEmailContent({
    quotation: {
      ...quotation,
      grandTotal: 125000,
      approvalDecision: {
        remarks: 'Pricing is too high.\nPlease revise <service scope>.',
        reviewerRole: 'Super Admin',
        actionAt: '2026-09-16T09:30:00.000Z'
      }
    },
    event: 'rejected',
    actor
  });
  assert.match(rejected.subject, /AT\/26-27\/001 - Rejected/);
  assert.match(rejected.html, /ACTION REQUIRED/);
  assert.match(rejected.html, /Admin rejection notes/);
  assert.match(rejected.html, /Pricing is too high\.<br>Please revise &lt;service scope&gt;\./);
  assert.match(rejected.html, /₹1,25,000/);
  assert.match(rejected.html, /KRISHNA Yadav · Super Admin/);
  assert.match(rejected.html, /Open Quotation in CRM/);
  assert.doesNotMatch(rejected.html, /<service scope>/);
});
