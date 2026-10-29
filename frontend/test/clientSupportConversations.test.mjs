import test from 'node:test';
import assert from 'node:assert/strict';
import { supportConversations, messageContactId, chatDayLabel } from '../src/utils/clientSupportConversations.mjs';
const contacts = [{ id: 'sales@example.com', email: 'sales@example.com', name: 'Sales Person', role: 'Sales' }, { id: 'spoc@example.com', email: 'spoc@example.com', name: 'Account SPOC', role: 'SPOC' }];
test('chat conversations are separated by actual recipient and messages appear chronologically', () => {
  const conversations = supportConversations(contacts, [{ _id: '3', recipient: 'sales@example.com', body: 'Latest sales question', createdAt: '2026-10-29T07:00:00Z' }, { _id: '1', recipient: 'sales@example.com', body: 'Earlier sales question', createdAt: '2026-10-28T07:00:00Z' }, { _id: '2', recipient: 'spoc@example.com', body: 'Private SPOC question', createdAt: '2026-10-29T06:00:00Z' }]);
  assert.equal(conversations[0].id, 'sales@example.com');
  assert.deepEqual(conversations[0].messages.map(row => row._id), ['1','3']);
  assert.equal(conversations[1].messages[0].body, 'Private SPOC question');
  assert.ok(conversations.every(row => row.active));
});
test('removed contacts retain their history without being offered as active recipients', () => {
  const [historical] = supportConversations(contacts, [{ recipient: 'old@example.com', recipientName: 'Previous SPOC', body: 'Earlier message', createdAt: '2026-10-29T06:00:00Z' }]);
  assert.equal(historical.id, 'old@example.com'); assert.equal(historical.active, false); assert.equal(historical.messages.length, 1);
});
test('legacy messages only match unique name/role pairs and do not mix identical names', () => {
  assert.equal(messageContactId({ recipientName: 'Sales Person', recipientRole: 'Sales' }, contacts), 'sales@example.com');
  const duplicate = [...contacts, { id: 'other@example.com', name: 'Sales Person', role: 'Sales' }];
  assert.match(messageContactId({ recipientName: 'Sales Person', recipientRole: 'Sales' }, duplicate), /^history:/);
});
test('conversation day labels use Indian time across midnight', () => {
  const now = new Date('2026-10-29T01:00:00Z');
  assert.equal(chatDayLabel('2026-10-28T20:00:00Z', now), 'Today');
  assert.equal(chatDayLabel('2026-10-28T05:00:00Z', now), 'Yesterday');
  assert.equal(chatDayLabel('invalid', now), 'Earlier messages');
});
