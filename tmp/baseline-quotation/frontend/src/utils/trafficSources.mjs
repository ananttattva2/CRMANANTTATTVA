import { uniquePipelineRows } from './leadPipeline.mjs';
import { COMMUNICATION_MODE_GROUPS, COMMUNICATION_MODE_PARENTS, canonicalCommunicationMode, communicationModeParent } from '../constants/communicationModes.mjs';

export const BASE_TRAFFIC_SOURCES = [...Object.values(COMMUNICATION_MODE_GROUPS).flat(), 'Call'];
export const UNKNOWN_SOURCE = 'Other / Not specified';
export function trafficSourceKey(value) {
  return String(canonicalCommunicationMode(value) || UNKNOWN_SOURCE).trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'othernotspecified';
}
export function isExistingClientTrafficSource(row = {}) {
  const existingClientKey = trafficSourceKey('Existing Client');
  const savedModeKey = trafficSourceKey(row.communicationMode);
  const savedParentKey = trafficSourceKey(row.communicationModeParent);
  const inferredParentKey = trafficSourceKey(communicationModeParent(row.communicationMode));
  return savedModeKey === existingClientKey || savedParentKey === existingClientKey || inferredParentKey === existingClientKey;
}
export function trafficSourceSummary(rows = [], configured = []) {
  const modes = new Map();
  const addMode = (label, parent = '') => {
    const clean = canonicalCommunicationMode(label);
    if (!clean) return;
    const key = trafficSourceKey(clean);
    const resolvedParent = COMMUNICATION_MODE_PARENTS.includes(parent) ? parent : communicationModeParent(clean);
    if (!modes.has(key)) modes.set(key, { key, label: clean, parent: resolvedParent, count: 0 });
    else if (resolvedParent && !modes.get(key).parent) modes.get(key).parent = resolvedParent;
  };
  for (const label of [...BASE_TRAFFIC_SOURCES, ...configured, UNKNOWN_SOURCE]) addMode(label);
  for (const row of rows) addMode(row.communicationMode || UNKNOWN_SOURCE, row.communicationModeParent);
  const unique = uniquePipelineRows(rows);
  for (const row of unique) {
    const key = trafficSourceKey(row.communicationMode);
    if (!modes.has(key)) addMode(row.communicationMode || UNKNOWN_SOURCE, row.communicationModeParent);
    modes.get(key).count += 1;
  }
  return [...modes.values()].map(source => ({ ...source, percentage: unique.length ? source.count / unique.length * 100 : 0 }));
}

export function trafficSourceHierarchy(rows = [], configured = []) {
  const sources = trafficSourceSummary(rows, configured);
  const total = uniquePipelineRows(rows).length;
  const usedKeys = new Set();
  const groups = COMMUNICATION_MODE_PARENTS.map((label) => {
    const children = sources.filter((source) => source.parent === label);
    children.forEach((source) => usedKeys.add(source.key));
    const count = children.reduce((sum, source) => sum + source.count, 0);
    return {
      key: `parent-${trafficSourceKey(label)}`,
      label,
      count,
      percentage: total ? count / total * 100 : 0,
      keys: children.map((source) => source.key),
      children
    };
  });
  const unmapped = sources.filter((source) => !usedKeys.has(source.key));
  if (unmapped.length) {
    const count = unmapped.reduce((sum, source) => sum + source.count, 0);
    groups.push({
      key: 'parent-unmapped', label: 'Other / Unmapped', count,
      percentage: total ? count / total * 100 : 0,
      keys: unmapped.map((source) => source.key), children: unmapped
    });
  }
  return groups;
}
