import test from 'node:test';
import assert from 'node:assert/strict';
import { pipelinePeriodRange, inPipelinePeriod } from '../src/utils/leadPipeline.mjs';
test('all time includes legacy rows without dates', () => {
 assert.equal(inPipelinePeriod(null, pipelinePeriodRange('all')), true);
});
test('week starts Monday, includes Sunday and excludes next Monday', () => {
 const range = pipelinePeriodRange('week', '2026-11-04');
 assert.equal(inPipelinePeriod('2026-11-02T00:00:00', range), true);
 assert.equal(inPipelinePeriod('2026-11-08T23:59:59', range), true);
 assert.equal(inPipelinePeriod('2026-11-09T00:00:00', range), false);
 assert.equal(inPipelinePeriod('2026-11-01T23:59:59', range), false);
});
test('month handles leap years and excludes missing or invalid dates', () => {
 const range = pipelinePeriodRange('month', '2024-02-15');
 assert.equal(inPipelinePeriod('2024-02-29T12:00:00', range), true);
 assert.equal(inPipelinePeriod('2024-03-01T00:00:00', range), false);
 assert.equal(inPipelinePeriod(null, range), false);
 assert.equal(inPipelinePeriod('invalid', range), false);
});
test('calendar year has exclusive next-year boundary', () => {
 const range = pipelinePeriodRange('year', '2026-11-02');
 assert.equal(inPipelinePeriod('2026-01-01T00:00:00', range), true);
 assert.equal(inPipelinePeriod('2026-12-31T23:59:59', range), true);
 assert.equal(inPipelinePeriod('2027-01-01T00:00:00', range), false);
});

