import test from 'node:test';
import assert from 'node:assert/strict';
import { consentValidity } from '../src/utils/consentValidity.mjs';
test('consent date badges use the same two-month window and IST day as reminders', () => {
 const now=new Date('2026-11-01T20:00:00Z');
 assert.equal(consentValidity('2027-01-02',now).tone,'due');
 assert.equal(consentValidity('2027-01-03',now).tone,'active');
 assert.equal(consentValidity('2026-11-01',now).tone,'expired');
 assert.equal(consentValidity('',now).tone,'missing');
 assert.equal(consentValidity('2026-02-30',now).tone,'missing');
 assert.equal(consentValidity('2026-11-02',now).label,'Expires today');
});
