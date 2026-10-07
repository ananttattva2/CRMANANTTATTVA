const EXPLANATION_STAGES = ['Data Explained', 'Data Format Sent'];

export function withExplanationStages(data) {
  if (!data) return data;
  const saved = data.checklist || [];
  const explanations = EXPLANATION_STAGES.map(particular =>
    saved.find(row => row.particular === particular) || {
      particular, yesNo: '', date: '', files: [], remarks: ''
    }
  );
  const checklist = [...explanations, ...saved.filter(row => !EXPLANATION_STAGES.includes(row.particular))];
  return { ...data, checklist };
}
