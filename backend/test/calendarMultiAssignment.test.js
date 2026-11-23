const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/calendarItemController');
const Calendar = require('../src/models/CalendarItem');
const User = require('../src/models/User');
const { assigneesOf, validReminderTime } = require('../../shared/calendarAssignment.cjs');
const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
test('all selected users can access a shared Todo while unrelated users cannot', () => {
  const item = { createdByUser: 'creator', assignees: [{ id: ids[0], name: 'One', email: 'one@example.test' }, { id: ids[1], name: 'Two', email: 'two@example.test' }] };
  for (const id of ids) {
    assert.equal(controller.__test.canAccessCalendarItem(item, { _id: id }), true);
    assert.equal(controller.__test.canAccessCalendarScope(item, { ids: [id], identities: [] }), true);
  }
  assert.equal(controller.__test.canAccessCalendarItem(item, { _id: 'unrelated' }), false);
  assert.match(JSON.stringify(controller.__test.calendarScopeFilter({ ids: [ids[1]], identities: ['two@example.test'] })), /assignees.id/);
  assert.equal(assigneesOf({ assignedToId: ids[0], assignedToName: 'Legacy User' })[0].name, 'Legacy User');
});
test('calendar API requires a valid Reminder Time', async () => {
  for (const scheduledTime of ['', '25:00', '09:60']) {
    let code, response;
    await controller.createCalendarItem({ body: { title: 'Todo', scheduledTime }, user: {} }, { status(value) { code = value; return this; }, json(value) { response = value; } });
    assert.equal(code, 400); assert.match(response.error, /Reminder Time/);
  }
  assert.equal(validReminderTime('09:30'), true); assert.equal(validReminderTime('23:59'), true);
});
test('multi-user create resolves canonical user details and persists one shared Todo', async t => {
  t.mock.method(User, 'find', () => ({ select() { return this; }, lean: async () => ids.map((id, i) => ({ _id: id, name: `User ${i + 1}`, email: `user${i + 1}@example.test` })) }));
  let saved, response;
  t.mock.method(Calendar, 'create', async row => { saved = row; return { ...row, _id: 'todo' }; });
  await controller.createCalendarItem({ body: { title: 'Shared work', scheduledDate: '2026-11-23', scheduledTime: '10:30', assignees: [{ id: ids[0], name: 'Forged name' }, { id: ids[1] }] }, user: { name: 'Creator' } }, { status(value) { assert.equal(value, 201); return this; }, json(value) { response = value; } });
  assert.equal(saved.assignees.length, 2); assert.equal(saved.assignees[0].name, 'User 1'); assert.equal(saved.assignedTo, 'User 1, User 2');
  assert.equal(response.item.assignees[1].id, ids[1]);
});
