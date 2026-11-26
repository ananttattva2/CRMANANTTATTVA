const { calculateMtPerYear } = require('../../../shared/productQuantity.cjs');
const { resolveClientMasterData } = require('./clientMasterResolver');

function salesConsentComparison(client, upload) {
  if (upload?.importStatus !== 'Imported' || !Number.isFinite(upload.totalQuantity)) return null;
  const data = resolveClientMasterData(client);
  const category = data.basic?.subApplicantType || data.basic?.piboCategory || data.basic?.applicantType
    || data.selectedLeadSnapshot?.subApplicantType || data.selectedLeadSnapshot?.piboCategory || data.selectedLeadSnapshot?.applicantType;
  if (!/^producer\b/i.test(String(category || '').trim())) return null;

  const rows = (data.cte?.plantWiseDetails || []).flatMap(plant =>
    (plant.ctoProductRows || []).filter(row => row.productName || String(row.quantity ?? '').trim())
      .map(row => ({
        plant: plant.plantName || '',
        product: row.productName || '',
        annualMt: calculateMtPerYear(row)
      }))
  );
  const salesMt = upload.totalQuantity;
  const consentMt = rows.reduce((sum, row) => sum + (row.annualMt ?? 0), 0);
  const incomplete = !rows.length || rows.some(row => row.annualMt === null || !row.product);
  if (incomplete) return { rows, salesMt, consentMt, status: 'incomplete' };
  const differenceMt = Number((salesMt - consentMt).toPrecision(12));
  const differencePercent = salesMt > 0 ? Math.abs(differenceMt) / salesMt * 100 : null;
  const status = differenceMt > 0 ? 'red' : differencePercent === null ? 'neutral'
    : differencePercent < 20 ? 'green' : differencePercent < 40 ? 'amber' : 'neutral';
  return { rows, salesMt, consentMt, differenceMt, differencePercent, status };
}

module.exports = { salesConsentComparison };
