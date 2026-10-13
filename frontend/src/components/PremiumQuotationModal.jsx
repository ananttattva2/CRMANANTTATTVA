import React from 'react';
import CountUp from 'react-countup';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { periodDisplay } from '../utils/servicePeriod';

function toNumber(value) {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function AnimatedCurrency({ value, duration = 2, className = '' }) {
  return (
    <span className={className}>
      <CountUp
        start={0}
        end={toNumber(value)}
        duration={duration}
        decimals={2}
        decimal="."
        separator=","
        prefix="₹"
        easingFn={(t, b, c, d) => c * (1 - Math.pow(1 - t / d, 3)) + b}
      />
    </span>
  );
}

function AnimatedInteger({ value, duration = 1.5, className = '' }) {
  return (
    <span className={className}>
      <CountUp
        start={0}
        end={toNumber(value)}
        duration={duration}
        decimals={0}
        easingFn={(t, b, c, d) => c * (1 - Math.pow(1 - t / d, 3)) + b}
      />
    </span>
  );
}

function quotationItemKey(item = {}, index = 0) {
  return String(item.assignedServiceId || item.id || (Number.isInteger(Number(item.sourceServiceIndex)) ? `source:${Number(item.sourceServiceIndex)}` : `item:${index}`)).trim();
}

function groupedPricingRows(items = [], groups = [], combinedBasicAmount = 0, totalAmount = 0) {
  const normalizedGroups = Array.isArray(groups) && groups.length
    ? groups.map((group, index) => ({
      id: String(group?.id || `combined-group-${index + 1}`),
      name: String(group?.name || `Combined Group ${index + 1}`),
      itemKeys: [...new Set((Array.isArray(group?.itemKeys) ? group.itemKeys : []).map(String).filter(Boolean))],
      basicAmount: Number(group?.basicAmount) || 0
    }))
    : [{
      id: 'legacy-combined-group',
      name: 'Combined Group 1',
      itemKeys: items.map(quotationItemKey),
      basicAmount: Number(combinedBasicAmount) || Number(totalAmount) || 0
    }];
  const groupByItemKey = new Map();
  normalizedGroups.forEach((group) => group.itemKeys.forEach((key) => groupByItemKey.set(key, group)));
  const rows = items.map((item, index) => ({
    item,
    index,
    group: groupByItemKey.get(quotationItemKey(item, index)) || {
      id: `unassigned-${index}`,
      name: 'Individual item',
      basicAmount: Number(item?.basicAmount) || 0
    }
  }));
  const order = new Map(normalizedGroups.map((group, index) => [group.id, index]));
  rows.sort((left, right) => (order.get(left.group.id) ?? normalizedGroups.length) - (order.get(right.group.id) ?? normalizedGroups.length) || left.index - right.index);
  rows.forEach((row, rowIndex) => {
    row.firstInGroup = rowIndex === 0 || rows[rowIndex - 1]?.group?.id !== row.group.id;
    if (!row.firstInGroup) return;
    let runEnd = rowIndex + 1;
    while (runEnd < rows.length && rows[runEnd].group.id === row.group.id) runEnd += 1;
    row.groupSize = runEnd - rowIndex;
  });
  return rows;
}

export default function PremiumQuotationModal({
  open = true,
  onClose,
  overlayClassName = 'z-[220]',
  companyName = 'Quotation Details',
  quotationNumber = 'Quotation',
  totalAmount = 0,
  revisionCount = 0,
  userName = '-',
  piboCategory = '-',
  businessCategory = '-',
  serviceCategory = '-',
  items = [],
  pricingMode = 'individual',
  combinedBasicAmount = 0,
  combinedPricingGroups = []
}) {
  const groupedPricing = pricingMode === 'combined';
  const displayRows = groupedPricing
    ? groupedPricingRows(items, combinedPricingGroups, combinedBasicAmount, totalAmount)
    : items.map((item, index) => ({ item, index }));
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 ${overlayClassName} grid place-items-center bg-slate-950/55 p-5 backdrop-blur-[9px]`}
          role="presentation"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="relative max-h-[calc(100vh-40px)] w-full max-w-[980px] overflow-hidden rounded-xl border border-teal-100 bg-white shadow-[0_34px_90px_rgba(15,23,42,0.34)]"
            role="dialog"
            aria-modal="true"
            aria-label="Quotation Details"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: 18, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-700 via-emerald-500 to-orange-500" />

            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-br from-teal-50 via-white to-orange-50 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-teal-700">Quotation Status</p>
                <h3 className="mt-1 truncate text-lg font-black text-slate-950">{companyName}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:bg-teal-50"
                aria-label="Close Quotation Details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(100vh-118px)] overflow-auto p-5">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_170px]">
                <motion.div
                  className="rounded-xl border border-teal-100 bg-gradient-to-br from-white to-teal-50/40 p-4"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08, duration: 0.28 }}
                >
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{quotationNumber}</p>
                  <AnimatedCurrency value={totalAmount} duration={2} className="mt-2 block text-4xl font-black leading-none text-orange-500" />
                  <p className="mt-3 text-xs font-black text-teal-700">{groupedPricing ? 'Grouped Basic Amount (INR)' : 'Basic Amount (INR)'}</p>
                </motion.div>

                <motion.div
                  className="grid place-items-center rounded-xl border border-blue-200 bg-blue-50 p-4 text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.14, duration: 0.28 }}
                >
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Number of Revision</p>
                    <AnimatedInteger value={revisionCount} duration={1.5} className="mt-3 block text-5xl font-black leading-none text-blue-600" />
                  </div>
                </motion.div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-7">
                {[
                  ['Company Name', companyName],
                  ['User Name', userName],
                  ['Applicant Type', piboCategory],
                  ['Business Category', businessCategory],
                  ['Service Category', serviceCategory],
                  ['Select Period', typeof items[items.length - 1]?.periodUnit === 'string' ? (items[items.length - 1].periodUnit === 'days' ? 'Days' : items[items.length - 1].periodUnit === 'months' ? 'Month' : 'Annual') : 'Annual'],
                  ['Transition Period', items[items.length - 1]?.transitionPeriod || 'No']
                ].map(([label, value], index) => (
                  <motion.div
                    key={label}
                    className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.18 + index * 0.04, duration: 0.24 }}
                  >
                    <p className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{label}</p>
                    <strong className="mt-2 block break-words text-sm font-black uppercase text-slate-950">{value || '-'}</strong>
                  </motion.div>
                ))}
              </div>

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><h4 className="font-black text-slate-950">Quotation Items</h4><span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${groupedPricing ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-700'}`}>{groupedPricing ? 'Grouped pricing' : 'Individual pricing'}</span></div>
                  <span className="text-xs font-black uppercase tracking-[0.1em] text-slate-500"><AnimatedInteger value={items.length} duration={1.2} /> item{items.length === 1 ? '' : 's'}</span>
                </div>
                <div className="overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.06em] text-slate-600">
                      <tr>
                        {['Sr.No', 'Business Category', 'Service Category', 'Service Period', 'Select Period', 'Transition Period', 'Service Category', 'Applicant Type', 'Unit', ...(groupedPricing ? ['Pricing Group'] : []), groupedPricing ? 'Group Amount (INR)' : 'Basic Amount (INR)'].map((header) => (
                          <th key={header} className="border-r border-slate-200 px-3 py-3 last:border-r-0">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.length ? displayRows.map(({ item, index, group, firstInGroup, groupSize }) => (
                        <motion.tr
                          key={`${item.serviceCategory || 'item'}-${index}`}
                          className="border-t border-slate-100"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.26 + index * 0.06, duration: 0.24 }}
                        >
                          <td className="px-3 py-3 text-center font-black text-slate-800">{index + 1}</td>
                          <td className="px-3 py-3 font-black uppercase text-slate-800">{item.businessCategory || '-'}</td>
                          <td className="px-3 py-3 font-black uppercase text-slate-800">{item.serviceCategory || '-'}</td>
                          <td className="px-3 py-3 font-black text-slate-700">{periodDisplay(item.servicePeriod, item.periodUnit)}</td>
                          <td className="px-3 py-3 font-black text-slate-700">{String(item.periodUnit || 'annual') === 'days' ? 'Days' : String(item.periodUnit || 'annual') === 'months' ? 'Month' : 'Annual'}</td>
                          <td className="px-3 py-3 font-black text-slate-700">{item.transitionPeriod || 'No'}</td>
                          <td className="px-3 py-3 font-black uppercase text-slate-700">{item.eprCategory || '-'}</td>
                          <td className="px-3 py-3 font-black uppercase text-slate-700">{item.piboCategory || '-'}</td>
                          <td className="px-3 py-3 font-black text-slate-700">{item.unit || '-'}</td>
                          {groupedPricing && firstInGroup && <td rowSpan={groupSize} className="border-l border-slate-100 px-3 py-3 text-center align-middle font-black text-emerald-700">{group.name}</td>}
                          {(!groupedPricing || firstInGroup) && <td rowSpan={groupedPricing ? groupSize : undefined} className="px-3 py-3 text-right align-middle font-black text-orange-500"><AnimatedCurrency value={groupedPricing ? group.basicAmount : item.basicAmount} duration={2} /></td>}
                        </motion.tr>
                      )) : (
                        <tr><td colSpan={groupedPricing ? 11 : 10} className="px-4 py-8 text-center font-black text-slate-400">No quotation items added.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
