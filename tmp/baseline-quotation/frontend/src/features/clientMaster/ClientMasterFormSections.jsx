import React, { useState } from 'react';
import { Building2, CheckCircle2, ChevronDown, Copy, Eye, FileCheck2, FileText, MapPin, Pencil, Plus, Smartphone, Trash2, Upload, UserRound, UsersRound } from 'lucide-react';
import SearchableSelect from '../../components/form/SearchableSelect';
import PremiumDatePicker from '../../components/form/PremiumDatePicker';
import { mediaUrl, uploadMedia, uploadMediaBatch } from '../../services/mediaUpload';

function AddressTab({ client, setValue, copyRegisteredAddress, selectOptions }) {
  return (
    <Card title="Company Address Details">
      <div className="grid gap-6">
        <AddressPanel title="Registered Office Address" section="registeredAddress" data={client.registeredAddress} setValue={setValue} selectOptions={selectOptions} />
        <AddressPanel title="Communication Office Address" section="communicationAddress" data={client.communicationAddress} setValue={setValue} onCopy={copyRegisteredAddress} selectOptions={selectOptions} />
      </div>
    </Card>
  );
}

function AddressPanel({ title, section, data, setValue, onCopy, selectOptions }) {
  const isRegistered = section === 'registeredAddress';
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_34px_rgba(15,76,66,0.07)]">
      <header className={`flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4 ${isRegistered ? 'border-blue-100 bg-gradient-to-r from-blue-50 via-white to-cyan-50' : 'border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50'}`}>
        <div className="flex items-center gap-3"><span className={`grid h-11 w-11 place-items-center rounded-xl ${isRegistered ? 'bg-blue-600 text-white' : 'bg-emerald-700 text-white'}`}>{isRegistered ? <Building2 className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}</span><div><h3 className="text-xl font-black text-slate-950">{title}</h3><p className="mt-1 text-xs font-bold text-slate-500">{isRegistered ? 'Official registered address used for company records.' : 'Primary address used for correspondence and deliveries.'}</p></div></div>
        {onCopy && <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-800 shadow-sm hover:bg-emerald-50"><input type="checkbox" className="h-4 w-4 accent-emerald-700" onChange={(event) => onCopy(event.target.checked)} /><Copy className="h-4 w-4" /> Same as Registered Address</label>}
      </header>
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="lg:col-span-2"><Field required label="Address Line 1"><input className="form-input" value={data.address1 || ''} onChange={(event) => setValue(section, 'address1', event.target.value)} placeholder="Enter complete street address" /></Field></div>
        <Field label="Address Line 2"><input className="form-input" value={data.address2 || ''} onChange={(event) => setValue(section, 'address2', event.target.value)} placeholder="Building, floor or landmark" /></Field>
        <Field label="Address Line 3"><input className="form-input" value={data.address3 || ''} onChange={(event) => setValue(section, 'address3', event.target.value)} placeholder="Area or locality" /></Field>
        <SelectLike required label="State" value={data.state || ''} options={selectOptions.states} onChange={(value) => setValue(section, 'state', value)} />
        <SelectLike required label="City" value={data.city || ''} options={selectOptions.cities} placeholder={data.state ? 'Select or type city' : 'Select state first'} disabled={!data.state} onChange={(value) => setValue(section, 'city', value)} />
        <Field required label="Pincode"><input className="form-input" inputMode="numeric" value={data.pincode || ''} onChange={(event) => setValue(section, 'pincode', event.target.value)} placeholder="Enter 6-digit pincode" /></Field>
        <div className="flex items-end"><div className="flex min-h-[50px] w-full items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 text-xs font-black text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Required fields count toward completion progress.</div></div>
      </div>
    </section>
  );
}

function ComplianceTab({ client, setValue, addRow, updateRow, removeRow, complianceRows, applicableComplianceRows = complianceRows }) {
  const applicableKeys = new Set(applicableComplianceRows.map(([key]) => key));
  const msmeApplicable = client.compliance?.msmeApplicable || '';
  const applicantType = String(client.basic?.piboCategory || client.selectedLeadSnapshot?.piboCategory || '').trim().toLowerCase();
  const isBrandOwner = applicantType.includes('brand owner');
  const brandOwnerProductionFacility = client.compliance?.brandOwnerProductionFacility
    || (client.compliance?.factoryLicenseApplicability === 'Applicable' ? 'Yes' : 'No');
  return (
    <>
      <Card title="Compliance Certificate Upload">
        {isBrandOwner && <div className="mb-5 rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div><p className="text-sm font-black text-slate-900">Does the Brand Owner have a Production Facility?</p><p className="mt-1 text-xs font-semibold text-slate-500">Select Yes to enter the Factory License details. Select No when the Brand Owner has no production facility.</p></div>
            <div className="flex flex-wrap gap-3">{['Yes', 'No'].map((value) => <button key={value} type="button" onClick={() => { setValue('compliance', 'brandOwnerProductionFacility', value); setValue('compliance', 'factoryLicenseApplicability', value === 'Yes' ? 'Applicable' : 'Not Applicable'); if (value === 'No') setValue('compliance', 'factoryLicenseApplicabilityReason', ''); }} className={`rounded-xl border px-7 py-3 text-sm font-black ${brandOwnerProductionFacility === value ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{value}</button>)}</div>
          </div>
          {brandOwnerProductionFacility === 'Yes' && <p className="mt-3 text-xs font-bold text-orange-700">Factory License number, date, and document are enabled, required, and included in the Document percentage.</p>}
          {brandOwnerProductionFacility === 'No' && <p className="mt-3 text-xs font-bold text-emerald-700">Factory License is disabled and does not affect validation or completion percentage.</p>}
        </div>}
        <div className="grid gap-4 xl:grid-cols-2">
          {complianceRows.map(([key, numberLabel, dateLabel, fileLabel]) => {
            const applicable = applicableKeys.has(key);
            return <section key={key} className={`rounded-2xl border p-4 shadow-sm ${applicable ? 'border-slate-200 bg-gradient-to-br from-white to-slate-50/80' : 'border-slate-200 bg-slate-100 opacity-60'}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`${numberLabel}${applicable ? '' : ' (Not Applicable)'}`}><input disabled={!applicable} className="form-input" value={client.compliance[`${key}Number`] || ''} onChange={(event) => setValue('compliance', `${key}Number`, event.target.value)} /></Field>
                <Field label={dateLabel}><PremiumDatePicker disabled={!applicable} value={client.compliance[`${key}Date`] || ''} onChange={(event) => setValue('compliance', `${key}Date`, event.target.value)} /></Field>
              </div>
              <div className="mt-4 border-t border-slate-200 pt-4">
                <Field label={fileLabel}>{applicable ? <UploadButton value={client.compliance[`${key}File`]} onChange={(value) => setValue('compliance', `${key}File`, value)} /> : <span className="inline-flex min-h-10 items-center rounded-lg bg-slate-200 px-3 text-xs font-black text-slate-500">Not required</span>}</Field>
              </div>
            </section>
          })}
        </div>
      </Card>

      <Card title="MSME Details">
        <div className="rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50 to-emerald-50 p-5">
          <p className="text-sm font-black text-slate-900">Is MSME applicable for this client?</p>
          <div className="mt-3 flex flex-wrap gap-3">{[['Yes', 'Applicable'], ['No', 'Not Applicable']].map(([value, label]) => <button key={value} type="button" onClick={() => setValue('compliance', 'msmeApplicable', value)} className={`rounded-xl border px-5 py-3 text-sm font-black ${msmeApplicable === value ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{label}</button>)}</div>
          {!msmeApplicable && <p className="mt-3 text-xs font-bold text-orange-700">Select applicability to complete the Document tab.</p>}
          {msmeApplicable === 'No' && <p className="mt-3 text-xs font-bold text-emerald-700">MSME details are not required and will not affect validation or completion percentage.</p>}
        </div>
        {msmeApplicable === 'Yes' && <DynamicTable
          rows={client.msmeRows}
          columns={[
            ['classificationYear', 'MSME Classification Year *'],
            ['status', 'MSME Status *'],
            ['majorActivity', 'MSME Major Activity *'],
            ['udyamNumber', 'MSME Udyam Number *'],
            ['turnover', 'TurnOver of the Company (CR.) *']
          ]}
          uploadColumn="MSME Udyam Certificate"
          onAdd={() => addRow('msmeRows', { classificationYear: '', status: '', majorActivity: '', udyamNumber: '', turnover: '', file: '' })}
          onUpdate={(index, field, value) => updateRow('msmeRows', index, field, value)}
          onRemove={(index) => removeRow('msmeRows', index)}
        />}
      </Card>
    </>
  );
}

const emptyPlantConsent = {
  plantName: '',
  cteConsentNo: '',
  cteCategory: '',
  cteIssuedDate: '',
  cteValidDate: '',
  plantLocation: '',
  cteDocument: null,
  cteProductionRows: [],
  ctoOrderNo: '',
  ctoIssueDate: '',
  ctoValidDate: '',
  ctoDocument: null,
  ctoProductRows: []
};

function TableInput({ value, onChange, placeholder = '', type = 'text', options }) {
  if (type === 'date') {
    return (
      <div className="min-w-52">
        <PremiumDatePicker
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder || 'DD/MM/YYYY'}
        />
      </div>
    );
  }

  if (options) {
    return <div className="min-w-44"><SearchableSelect value={value || ''} options={options} onChange={onChange} placeholder={placeholder || 'Select'} /></div>;
  }

  return (
    <input
      type={type}
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="form-input min-h-10 min-w-44 uppercase"
    />
  );
}

function TableUpload({ value, onChange }) {
  return (
    <div className="min-w-44">
      <UploadButton value={value} onChange={onChange} />
    </div>
  );
}

function ConsentTable({ title, eyebrow, plants, columns, onPlantChange }) {
  return (
    <section>
      <div className="mb-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#30737B]">{eyebrow}</p>
        <h3 className="mt-1 text-2xl font-black text-slate-950">{title}</h3>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-teal-200 bg-gradient-to-r from-teal-50 via-emerald-50 to-cyan-50 text-xs font-black uppercase tracking-[0.08em] text-teal-900">
              <tr>
                <th className="w-20 px-4 py-4 text-center">Sr.No</th>
                <th className="px-4 py-4">Plant Name</th>
                {columns.map((column) => <th key={column.key} className="px-4 py-4">{column.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plants.map((plant, plantIndex) => (
                <tr key={plantIndex} className="transition hover:bg-orange-50/60">
                  <td className="px-4 py-3 text-center font-black text-slate-800">{plantIndex + 1}</td>
                  <td className="px-4 py-3">
                    <TableInput value={plant.plantName} onChange={(value) => onPlantChange(plantIndex, 'plantName', value)} placeholder={`Plant ${plantIndex + 1}`} />
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3">
                      {column.type === 'file' ? (
                        <TableUpload value={plant[column.key]} onChange={(value) => onPlantChange(plantIndex, column.key, value)} />
                      ) : (
                        <TableInput
                          type={column.type}
                          value={plant[column.key]}
                          options={column.options}
                          placeholder={column.placeholder}
                          onChange={(value) => onPlantChange(plantIndex, column.key, value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PlantQuantityTable({ title, plants, quantityKey, columns, rowTemplate, onAddRow, onUpdateRow, onRemoveRow, onPlantNameChange }) {
  const [selectedPlantIndex, setSelectedPlantIndex] = useState(0);
  const safePlantIndex = Math.min(selectedPlantIndex, Math.max(plants.length - 1, 0));
  const rows = plants.flatMap((plant, plantIndex) =>
    (plant[quantityKey] || []).map((row, rowIndex) => ({ plant, plantIndex, row, rowIndex }))
  );

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="text-2xl font-black text-slate-950">{title}</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          {plants.length > 1 && (
            <div className="min-w-52"><SearchableSelect value={String(safePlantIndex)} onChange={(value) => setSelectedPlantIndex(Number(value))} options={plants.map((plant, index) => ({ value: String(index), label: plant.plantName || `Plant ${index + 1}` }))} placeholder="Select plant" /></div>
          )}
          <button type="button" onClick={() => onAddRow(safePlantIndex, quantityKey, rowTemplate)} className="btn-lift inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 font-black text-white shadow-lg shadow-emerald-700/20">
            <Plus className="h-4 w-4" /> Add Row
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-teal-200 bg-gradient-to-r from-teal-50 via-emerald-50 to-cyan-50 text-xs font-black uppercase tracking-[0.08em] text-teal-900">
              <tr>
                <th className="w-20 px-4 py-4 text-center">Sr.No</th>
                {columns.map(([field, label], index) => (
                  <React.Fragment key={field}>
                    <th className="px-4 py-4">{label}</th>
                    {index === 0 && <th className="px-4 py-4">Plant Name</th>}
                  </React.Fragment>
                ))}
                <th className="w-36 px-4 py-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 3} className="px-4 py-12 text-center font-black text-slate-400">No data</td>
                </tr>
              ) : (
                rows.map(({ plant, plantIndex, row, rowIndex }, index) => (
                  <tr key={`${plantIndex}-${rowIndex}`} className="transition hover:bg-orange-50/60">
                    <td className="px-4 py-3 text-center font-black text-slate-800">{index + 1}</td>
                    {columns.map(([field], columnIndex) => (
                      <React.Fragment key={field}>
                        <td className="px-4 py-3">
                          <TableInput value={row[field]} onChange={(value) => onUpdateRow(plantIndex, quantityKey, rowIndex, field, value)} />
                        </td>
                        {columnIndex === 0 && (
                          <td className="px-4 py-3">
                            <TableInput value={plant.plantName} onChange={(value) => onPlantNameChange(plantIndex, value)} placeholder={`Plant ${plantIndex + 1}`} />
                          </td>
                        )}
                      </React.Fragment>
                    ))}
                    <td className="px-4 py-3 text-center">
                      <button type="button" onClick={() => onRemoveRow(plantIndex, quantityKey, rowIndex)} className="rounded-lg border border-red-200 px-3 py-2 font-black text-red-600 hover:bg-red-50">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CteTab({ client, setValue, selectOptions }) {
  const plants = client.cte.plantWiseDetails || [];
  const cteApplicable = client.cte.cteApplicable || 'Yes';

  function setPlants(nextPlants) {
    setValue('cte', 'plantWiseDetails', nextPlants);
  }

  function setPlantCount(value) {
    const count = Math.max(0, Math.min(Number.parseInt(value, 10) || 0, 25));
    const nextPlants = Array.from({ length: count }, (_, index) => ({
      ...emptyPlantConsent,
      ...(plants[index] || {})
    }));
    setValue('cte', 'numberOfPlantsLocations', value);
    setPlants(nextPlants);
  }

  function updatePlant(plantIndex, field, value) {
    setPlants(plants.map((plant, index) => (index === plantIndex ? { ...plant, [field]: value } : plant)));
  }

  function addPlantRow(plantIndex, key, rowTemplate) {
    setPlants(plants.map((plant, index) => (
      index === plantIndex ? { ...plant, [key]: [...(plant[key] || []), rowTemplate] } : plant
    )));
  }

  function updatePlantRow(plantIndex, key, rowIndex, field, value) {
    setPlants(plants.map((plant, index) => (
      index === plantIndex
        ? { ...plant, [key]: (plant[key] || []).map((row, itemIndex) => (itemIndex === rowIndex ? { ...row, [field]: value } : row)) }
        : plant
    )));
  }

  function removePlantRow(plantIndex, key, rowIndex) {
    setPlants(plants.map((plant, index) => (
      index === plantIndex ? { ...plant, [key]: (plant[key] || []).filter((_, itemIndex) => itemIndex !== rowIndex) } : plant
    )));
  }

  return (
    <Card title="CTE & CTO/CCA Details">
      <div className="space-y-7">
        <div className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50 p-5">
          <p className="text-sm font-black text-slate-900">Is CTE Applicable?</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Select No when only CTO/CCA details apply. CTE fields will be hidden and excluded from completion percentage.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {['Yes', 'No'].map((option) => <button key={option} type="button" onClick={() => setValue('cte', 'cteApplicable', option)} className={`rounded-xl border px-7 py-3 text-sm font-black ${cteApplicable === option ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{option}</button>)}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
          <div className="grid gap-5 lg:grid-cols-[1fr_280px] lg:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#30737B]">Plant Setup</p>
              <h3 className="mt-1 text-xl font-black text-slate-950">Enter number of plant locations first</h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">If user enters 2, complete CTE and CTO/CCA detail tables will appear twice.</p>
            </div>
            <Field label="Number of Plant Locations">
              <input type="number" min="0" max="25" className="form-input" value={client.cte.numberOfPlantsLocations || ''} onChange={(event) => setPlantCount(event.target.value)} placeholder="1 or 2" />
            </Field>
          </div>
        </div>

        {!plants.length ? (
          <div className="rounded-2xl border border-dashed border-emerald-200 bg-white px-5 py-10 text-center">
            <MapPin className="mx-auto h-8 w-8 text-[#30737B]" />
            <h3 className="mt-3 text-lg font-black text-slate-950">Add plant count to begin</h3>
            <p className="mt-2 text-sm font-semibold text-slate-500">CTE and CTO/CCA tables unlock after entering plant locations count.</p>
          </div>
        ) : (
          <>
            {cteApplicable === 'Yes' && <ConsentTable
              title="CTE Details"
              eyebrow="Consent Establishment"
              plants={plants}
              columns={[
                { key: 'cteConsentNo', label: 'CTE Consent No.', placeholder: 'Enter consent no.' },
                { key: 'cteCategory', label: 'CTE Category', placeholder: 'Enter category' },
                { key: 'cteIssuedDate', label: 'CTE Issued Year', placeholder: 'DD/MM/YYYY', type: 'date' },
                { key: 'cteValidDate', label: 'CTE Valid Upto', placeholder: 'DD/MM/YYYY', type: 'date' },
                { key: 'plantLocation', label: 'Plant Location', placeholder: 'Enter location' },
                { key: 'cteDocument', label: 'CTE Document Upload', type: 'file' }
              ]}
              onPlantChange={updatePlant}
            />}

            {cteApplicable === 'Yes' && <PlantQuantityTable
              title="CTE Production Quantity per Year"
              plants={plants}
              quantityKey="cteProductionRows"
              columns={[['productName', 'Product Name'], ['capacity', 'Maximum Production Capacity / Year']]}
              rowTemplate={{ productName: '', capacity: '' }}
              onAddRow={addPlantRow}
              onUpdateRow={updatePlantRow}
              onRemoveRow={removePlantRow}
              onPlantNameChange={(plantIndex, value) => updatePlant(plantIndex, 'plantName', value)}
            />}

            <ConsentTable
              title="CTO/CCA Details"
              eyebrow="Consent Operation"
              plants={plants}
              columns={[
                { key: 'ctoOrderNo', label: 'CTO/CCA Consent Order No.', placeholder: 'Enter order no.' },
                { key: 'ctoIssueDate', label: 'CTO/CCA Date of Issue', placeholder: 'DD/MM/YYYY', type: 'date' },
                { key: 'ctoValidDate', label: 'CTO/CCA Valid Upto', placeholder: 'DD/MM/YYYY', type: 'date' },
                { key: 'ctoDocument', label: 'CTO/CCA Document Upload', type: 'file' }
              ]}
              onPlantChange={updatePlant}
            />

            <PlantQuantityTable
              title="CTO/CCA Product Quantity"
              plants={plants}
              quantityKey="ctoProductRows"
              columns={[['productName', 'Name Of The Product'], ['quantity', 'Quantity']]}
              rowTemplate={{ productName: '', quantity: '' }}
              onAddRow={addPlantRow}
              onUpdateRow={updatePlantRow}
              onRemoveRow={removePlantRow}
              onPlantNameChange={(plantIndex, value) => updatePlant(plantIndex, 'plantName', value)}
            />
          </>
        )}
      </div>
    </Card>
  );
}

function CpcbTab({ client, setValue, selectOptions, applicability }) {
  const linked = client.cpcb.linkedToCommonPortal || '';
  const registrationFieldsApplicable = !applicability?.isPwp;
  const [showCeprPassword, setShowCeprPassword] = useState(false);
  const [showCpcbPassword, setShowCpcbPassword] = useState(false);
  return (
    <Card title="CPCB Login Credentials">
      <div className="mb-6 rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50 to-emerald-50 p-5">
        <p className="text-sm font-black text-slate-900">Have you linked your CPCB account to the Common Portal?</p>
        <div className="mt-4 flex gap-3">
          {['Yes', 'No'].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setValue('cpcb', 'linkedToCommonPortal', option)}
              className={`min-w-24 rounded-xl border px-5 py-3 text-sm font-black transition ${
                linked === option
                  ? 'border-teal-700 bg-teal-700 text-white shadow-lg shadow-teal-900/15'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {linked === 'Yes' && <div className="grid gap-5 md:grid-cols-2">
        <div className="grid gap-5 md:col-span-2 md:grid-cols-[1.25fr_0.75fr_0.75fr]">
          <SelectLike required label="CPCB Status" value={client.cpcb.status || ''} options={selectOptions.cpcbStatus} onChange={(value) => setValue('cpcb', 'status', value)} />
          <Field label="Unit ID"><input className="form-input" value={client.cpcb.unitId || ''} onChange={(event) => setValue('cpcb', 'unitId', event.target.value)} placeholder="Enter Unit ID" /></Field>
          <Field label="CPCB Home Page"><UploadButton value={client.cpcb.homePageFile} onChange={(value) => setValue('cpcb', 'homePageFile', value)} /></Field>
        </div>
        <Field label={`CPCB Registration Number${registrationFieldsApplicable ? '' : ' (Not Applicable)'}`}><input disabled={!registrationFieldsApplicable} className="form-input" value={client.cpcb.registrationNumber || ''} onChange={(event) => setValue('cpcb', 'registrationNumber', event.target.value)} /></Field>
        <Field label={`Application Number${registrationFieldsApplicable ? '' : ' (Not Applicable)'}`}><input disabled={!registrationFieldsApplicable} className="form-input" value={client.cpcb.applicationNumber || ''} onChange={(event) => setValue('cpcb', 'applicationNumber', event.target.value)} /></Field>
        <Field label="Date of Application"><PremiumDatePicker value={client.cpcb.applicationDate || ''} onChange={(event) => setValue('cpcb', 'applicationDate', event.target.value)} /></Field>
        <Field label="Date of Application Approval"><PremiumDatePicker value={client.cpcb.approvalDate || ''} onChange={(event) => setValue('cpcb', 'approvalDate', event.target.value)} /></Field>
        <Field label="CEPR User ID"><input className="form-input" value={client.cpcb.ceprUserId || ''} onChange={(event) => setValue('cpcb', 'ceprUserId', event.target.value)} /></Field>
        <PasswordField label="CEPR Password" value={client.cpcb.ceprPassword || ''} visible={showCeprPassword} onToggle={() => setShowCeprPassword((value) => !value)} onChange={(value) => setValue('cpcb', 'ceprPassword', value)} />
        <Field label="CPCB Login ID"><input className="form-input" value={client.cpcb.loginId || ''} onChange={(event) => setValue('cpcb', 'loginId', event.target.value)} /></Field>
        <PasswordField label="CPCB Login Password" value={client.cpcb.loginPassword || ''} visible={showCpcbPassword} onToggle={() => setShowCpcbPassword((value) => !value)} onChange={(value) => setValue('cpcb', 'loginPassword', value)} />
        <div className="md:col-span-2"><Field label="Remark"><textarea className="form-input min-h-[110px] resize-y py-3" value={client.cpcb.remark || ''} onChange={(event) => setValue('cpcb', 'remark', event.target.value)} placeholder="Enter Remark" /></Field></div>
      </div>}
      {linked === 'No' && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="font-black text-slate-700">CPCB account is not linked to the Common Portal.</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">Login credentials and CPCB processing fields are not required.</p>
        </div>
      )}
    </Card>
  );
}

function PasswordField({ label, value, visible, onToggle, onChange }) {
  return <Field label={label}><div className="relative"><input type={visible ? 'text' : 'password'} className="form-input pr-12" value={value} onChange={(event) => onChange(event.target.value)} /><button type="button" onClick={onToggle} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-teal-50 hover:text-teal-700" aria-label={visible ? `Hide ${label}` : `View ${label}`} title={visible ? 'Hide password' : 'View password'}><Eye className="h-4 w-4" /></button></div></Field>;
}

function CpcbScreenshotTab({ client, setValue, setRoot, applicability, onValidationError }) {
  const processDiagramRequired = client.cpcb?.processDiagramRequired || '';
  const showProcessDiagram = !applicability?.hideProcessDiagram && (!applicability?.processDiagramChoiceRequired || processDiagramRequired === 'Yes' || (client.processDiagrams || []).length > 0);
  return (
    <div className="grid gap-6">
      {applicability?.processDiagramChoiceRequired && <section className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50 p-5">
        <p className="text-sm font-black text-slate-900">Is Process Flow Diagram required?</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">For Importer and Brand Owner, select Yes to upload the diagram or No to exclude it from completion percentage.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {['Yes', 'No'].map((option) => <button key={option} type="button" onClick={() => setValue('cpcb', 'processDiagramRequired', option)} className={`rounded-xl border px-7 py-3 text-sm font-black ${processDiagramRequired === option ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{option}</button>)}
        </div>
      </section>}
      <DocumentUploadSection
        title="CPCB Screenshot"
        items={Array.isArray(client.cpcbScreenshots) ? client.cpcbScreenshots : []}
        emptyText="No CPCB screenshots or documents uploaded yet."
        folder="crm/client-master/cpcb"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
        uploadTitle="Upload screenshots and documents"
        uploadHint="Select one file or multiple files at once for bulk upload. Give every file a clear name so the team can identify it later."
        fileTypeLabel="Screenshot / supporting document"
        namePlaceholder="e.g. CPCB dashboard screenshot"
        onValidationError={onValidationError}
        onChange={(nextItems) => setRoot('cpcbScreenshots', nextItems)}
      />
      {showProcessDiagram && <DocumentUploadSection
        title="Process Flow Diagram (PFD) and Machinery Diagram"
        items={Array.isArray(client.processDiagrams) ? client.processDiagrams : []}
        emptyText="No Process Flow Diagram or Machinery Diagram PDFs uploaded yet."
        folder="crm/client-master/process-diagrams"
        accept="application/pdf,.pdf"
        uploadTitle="Upload PFD and Machinery Diagram PDFs"
        uploadHint="Upload one PDF or bulk upload multiple PDFs. Enter a clear document name for every PFD or machinery diagram."
        fileTypeLabel="PFD / Machinery Diagram PDF"
        namePlaceholder="e.g. Process Flow Diagram - Unit 1"
        pdfOnly
        onValidationError={onValidationError}
        onChange={(nextItems) => setRoot('processDiagrams', nextItems)}
      />}
    </div>
  );
}

function DocumentUploadSection({
  title,
  items,
  emptyText,
  folder,
  accept,
  uploadTitle,
  uploadHint,
  fileTypeLabel,
  namePlaceholder,
  pdfOnly = false,
  onChange,
  onValidationError
}) {
  const safeItems = Array.isArray(items) ? items : [];

  function updateItems(nextItems) {
    onChange(nextItems);
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (pdfOnly && files.some((file) => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) {
      onValidationError?.('Only PDF files are allowed for Process Flow Diagram and Machinery Diagram.');
      return;
    }
    try {
      const cloudFiles = await uploadMediaBatch(files, folder);
      const uploaded = cloudFiles.map((file) => ({ id: file.publicId, name: '', file }));
      updateItems([...safeItems, ...uploaded]);
      onValidationError?.(`Add a name for ${uploaded.length === 1 ? 'the uploaded file' : `all ${uploaded.length} uploaded files`} before saving.`);
    } catch (error) {
      onValidationError?.(error.message || 'Unable to upload files to Cloudinary.');
    }
  }

  function updateItem(index, field, value) {
    updateItems(safeItems.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  return (
    <Card title={title}>
      <div className="rounded-2xl border border-dashed border-teal-300 bg-gradient-to-br from-teal-50 via-white to-orange-50 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#30737B] text-white shadow-lg shadow-teal-900/20"><Upload className="h-6 w-6" /></div>
        <h3 className="mt-4 text-xl font-black text-slate-950">{uploadTitle}</h3>
        <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold text-slate-500">{uploadHint}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <label className="btn-lift inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-white px-5 font-black text-emerald-800 shadow-sm hover:bg-emerald-50">
            <FileText className="h-4 w-4" /> Single Upload
            <input type="file" accept={accept} className="sr-only" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
          </label>
          <label className="btn-lift inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 px-6 font-black text-white shadow-lg shadow-emerald-700/20">
            <Upload className="h-4 w-4" /> Bulk Upload
            <input type="file" multiple accept={accept} className="sr-only" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
          </label>
        </div>
      </div>

      {safeItems.length ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {safeItems.map((item, index) => (
            <div key={item.id || index} className={`rounded-2xl border bg-white p-4 shadow-sm ${String(item.name || '').trim() ? 'border-slate-200' : 'border-red-300 ring-2 ring-red-50'}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-[#30737B]"><FileCheck2 className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-800">{item.file?.name || 'No file selected'}</p>
                  <p className="mt-1 text-xs font-bold text-slate-400">{fileTypeLabel}</p>
                </div>
                <button type="button" aria-label="Remove file" onClick={() => updateItems(safeItems.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-5 w-5" /></button>
              </div>
              <Field required label="Document Name">
                <input className="form-input" value={item.name || ''} onChange={(event) => updateItem(index, 'name', event.target.value)} placeholder={namePlaceholder} />
              </Field>
              {!String(item.name || '').trim() && <p className="mt-2 text-xs font-black text-red-500">Document name is required.</p>}
              <button type="button" onClick={() => window.open(item.file?.dataUrl || item.file?.url, '_blank', 'noopener,noreferrer')} className="mt-3 inline-flex items-center gap-2 text-sm font-black text-[#30737B]"><Eye className="h-4 w-4" /> Preview file</button>
            </div>
          ))}
        </div>
      ) : <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-10 text-center font-bold text-slate-400">{emptyText}</div>}
    </Card>
  );
}

function ContactsTab({ client, setValue, setRoot, applicability }) {
  const additionalPeople = Array.isArray(client.authorisedPersons) ? client.authorisedPersons : [];
  const additionalOtpContacts = Array.isArray(client.otpContacts) ? client.otpContacts : [];
  const additionalCoordinators = Array.isArray(client.coordinatingPersons) ? client.coordinatingPersons : [];
  function updateAdditional(index, field, value) { setRoot('authorisedPersons', additionalPeople.map((person, personIndex) => personIndex === index ? { ...person, [field]: value } : person)); }
  const authorisedRows = [client.authorised || {}, ...additionalPeople];
  const otpRows = [client.otp || {}, ...additionalOtpContacts];
  const coordinatingRows = [client.coordinating || {}, ...additionalCoordinators];
  const updateAuthorised = (index, field, value) => index === 0 ? setValue('authorised', field, value) : updateAdditional(index - 1, field, value);
  const authorisedFields = [['name', 'Authorised Person Name'], ['designation', 'Authorised Person Designation'], ['department', 'Department of authorised person'], ['reporting', 'Reporting Person Details'], ['mobile', 'Authorised Person Mobile'], ['email', 'Authorised Person Email'], ['pan', 'Authorised Person PAN Number'], ['panDocument', 'Authorised Person PAN Document', 'upload'], ...(applicability?.isTyreWasteRecycler ? [['aadhaarNumber', 'Aadhaar Card Number'], ['aadhaarDocument', 'Aadhaar Card Document', 'upload']] : [])];
  const updateExtraRow = (root, rows, index, field, value) => setRoot(root, rows.map((person, personIndex) => personIndex === index - 1 ? { ...person, [field]: value } : person));
  return (
    <>
      <ContactDetailsCard title="OTP Contact" icon={Smartphone} addLabel="Add OTP Contact" records={otpRows} fields={[['mobile', 'OTP Enabled Mobile No.'], ['personName', 'OTP Person Name'], ['designation', 'OTP Person Designation']]} onAdd={() => setRoot('otpContacts', [...additionalOtpContacts, { mobile: '', personName: '', designation: '' }])} onUpdate={(index, field, value) => index === 0 ? setValue('otp', field, value) : updateExtraRow('otpContacts', additionalOtpContacts, index, field, value)} onRemove={(index) => setRoot('otpContacts', additionalOtpContacts.filter((_, rowIndex) => rowIndex !== index - 1))} />
      <ContactDetailsCard title="Authorised Person" icon={UserRound} addLabel="Add Authorised Person" records={authorisedRows} fields={authorisedFields} onAdd={() => setRoot('authorisedPersons', [...additionalPeople, { name: '', designation: '', department: '', reporting: '', mobile: '', email: '', pan: '', panDocument: null, ...(applicability?.isTyreWasteRecycler ? { aadhaarNumber: '', aadhaarDocument: null } : {}) }])} onUpdate={updateAuthorised} onRemove={(index) => setRoot('authorisedPersons', additionalPeople.filter((_, rowIndex) => rowIndex !== index - 1))} />
      <ContactDetailsCard title="Coordinating Person" icon={UsersRound} addLabel="Add Coordinating Person" records={coordinatingRows} fields={[['name', 'Coordinating Person Name'], ['designation', 'Coordinating Person Designation'], ['department', 'Department of coordinating person'], ['reporting', 'Reporting Person Details'], ['mobile', 'Coordinating Person Mobile'], ['email', 'Coordinating Person Email']]} onAdd={() => setRoot('coordinatingPersons', [...additionalCoordinators, { name: '', designation: '', department: '', reporting: '', mobile: '', email: '' }])} onUpdate={(index, field, value) => index === 0 ? setValue('coordinating', field, value) : updateExtraRow('coordinatingPersons', additionalCoordinators, index, field, value)} onRemove={(index) => setRoot('coordinatingPersons', additionalCoordinators.filter((_, rowIndex) => rowIndex !== index - 1))} />
    </>
  );
}

function ContactDetailsCard({ title, icon: Icon, addLabel, records, fields, onAdd, onUpdate, onRemove }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 text-[#087579]"><Icon className="h-7 w-7" /><h2 className="text-xl font-black">{title}</h2></div><button type="button" aria-label={title === 'Authorised Person' ? 'Add Authorized Person' : addLabel} onClick={onAdd} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#087579] to-[#00676b] px-4 font-black text-white shadow-md"><Plus className="h-4 w-4" /> {addLabel}</button></header>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-emerald-200 bg-emerald-100 text-emerald-950"><tr><th className="w-14 px-4 py-3">#</th>{fields.map(([, label]) => <th key={label} className="px-4 py-3">{label}</th>)}<th className="w-28 px-4 py-3 text-center">Action</th></tr></thead>
          <tbody>{records.map((record, recordIndex) => <tr key={record.id || recordIndex} className="border-t border-slate-200 transition hover:bg-emerald-50/40">
            <td className="px-4 py-3 font-black text-slate-500">{recordIndex + 1}</td>
            {fields.map((definition) => <td key={definition[0]} className="px-3 py-2">{definition[2] === 'upload' ? <UploadButton value={record[definition[0]]} onChange={(value) => onUpdate(recordIndex, definition[0], value)} /> : <input type={definition[0] === 'email' ? 'email' : definition[0] === 'mobile' ? 'tel' : 'text'} aria-label={`${title} ${recordIndex + 1} ${definition[1]}`} className="form-input min-h-10 min-w-36 bg-white" value={record[definition[0]] || ''} onChange={(event) => onUpdate(recordIndex, definition[0], event.target.value)} />}</td>)}
            <td className="px-3 py-2"><div className="flex justify-center gap-2"><button type="button" aria-label={`Edit ${title} ${recordIndex + 1}`} onClick={(event) => event.currentTarget.closest('tr')?.querySelector('input')?.focus()} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50"><Pencil className="h-4 w-4" /></button>{recordIndex > 0 && <button type="button" aria-label={`Remove ${title} ${recordIndex + 1}`} onClick={() => onRemove(recordIndex)} className="grid h-9 w-9 place-items-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function DynamicTable({ title, rows, columns, uploadColumn, onAdd, onUpdate, onRemove }) {
  return (
    <div className="mt-6">
      {title && <h3 className="text-xl font-black text-slate-950">{title}</h3>}
      <button type="button" onClick={onAdd} className="btn-lift mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 font-black text-white shadow-lg shadow-emerald-700/20">
        <Plus className="h-4 w-4" /> Add Row
      </button>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Sr.No</th>
              {columns.map(([, label]) => <th key={label} className="px-4 py-4">{label}</th>)}
              {uploadColumn && <th className="px-4 py-4">{uploadColumn}</th>}
              <th className="px-4 py-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (uploadColumn ? 3 : 2)} className="px-4 py-12 text-center font-black text-slate-400">No data</td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-slate-100">
                <td className="px-4 py-3 font-black">{index + 1}</td>
                {columns.map(([field]) => (
                  <td key={field} className="px-4 py-3">
                    <input className="form-input min-h-10" value={row[field] || ''} onChange={(event) => onUpdate(index, field, event.target.value)} />
                  </td>
                ))}
                {uploadColumn && <td className="px-4 py-3"><UploadButton value={row.file} onChange={(value) => onUpdate(index, 'file', value)} /></td>}
                <td className="px-4 py-3 text-center">
                  <button type="button" onClick={() => onRemove(index)} className="rounded-lg border border-red-200 px-3 py-2 font-black text-red-600 hover:bg-red-50">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UploadButton({ value, onChange }) {
  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    onChange(await uploadMedia(file, 'crm/client-master/documents'));
  }

  function viewFile() {
    const url = mediaUrl(value);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <label className="btn-lift inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 font-black text-slate-700 hover:bg-slate-50">
          <Upload className="h-4 w-4" /> Upload
          <input type="file" className="sr-only" onChange={handleFile} />
        </label>
        {(value?.dataUrl || value?.url || typeof value === 'string') && (
          <button type="button" onClick={viewFile} className="btn-lift inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 font-black text-emerald-700 hover:bg-emerald-100">
            <Eye className="h-4 w-4" /> View
          </button>
        )}
      </div>
      {value?.name && <p className="max-w-56 truncate text-xs font-bold text-slate-500">{value.name}</p>}
    </div>
  );
}

function Card({ title, children, className = '' }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-700">{label} {required && <span className="text-red-500">*</span>}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function SelectLike({ label, required, value, options = [], onChange, disabled = false, placeholder = 'Select or type to create new' }) {
  return (
    <Field label={label} required={required}>
      <SearchableSelect value={value} options={options} onChange={onChange} disabled={disabled} placeholder={placeholder} />
    </Field>
  );
}


export {
  AddressTab,
  ComplianceTab,
  CteTab,
  CpcbTab,
  CpcbScreenshotTab,
  ContactsTab,
  Card,
  Field,
  SelectLike,
  UploadButton
};

