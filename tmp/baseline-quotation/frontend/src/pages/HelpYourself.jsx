import React, { useMemo, useState } from 'react'
import DashboardShell from '../components/dashboard/DashboardShell'

const helpCards = [
  { key: 'lead', title: 'Lead', description: 'Guided lead workflow and follow-up best practices.' },
  { key: 'client-master', title: 'Client Master', description: 'Client master controls and customer lifecycle guidance.' },
  { key: 'quotation', title: 'Quotation', description: 'Quotation creation, review, and approval tips.' },
  { key: 'proforma-invoice', title: 'Proforma Invoice', description: 'Proforma invoice preparation and delivery help.' }
]

const leadFlowSteps = [
  'Click "Add Lead" button',
  'Search client name',
  'Check whether lead already exists',
  'Create new lead for self or other user',
  'Or add service / request special approval',
  'Fill lead details and follow up',
  'Close lead and assign to manager',
  'Manager assigns to staff for onboarding',
  'Claim royalty if applicable next year'
]

const reminderTimeline = [
  {
    title: '30 min before',
    description: 'First email reminder is sent for the upcoming follow-up.',
    tone: 'amber'
  },
  {
    title: '30 min after',
    description: 'A second reminder is sent if the follow-up status is still not updated.',
    tone: 'slate'
  },
  {
    title: '60 min after',
    description: 'A third reminder is sent if the follow-up remains open.',
    tone: 'slate'
  },
  {
    title: '24 hours after',
    description: 'The lead is marked as a red flag if the follow-up is still not updated.',
    tone: 'rose'
  },
  {
    title: '48 hours after',
    description: 'If no action is recorded, the lead receives a permanent red flag. Saving a new follow-up action resets it to green.',
    tone: 'rose'
  }
]

function TopicCard({ card, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-full min-h-[148px] flex-col justify-between rounded-2xl border p-4 text-left transition duration-200 ${active ? 'border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100/70' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
    >
      <div>
        <p className="text-base font-semibold text-slate-900">{card.title}</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">{card.description}</p>
      </div>
      <span className={`mt-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-black ${active ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{card.title.slice(0, 1)}</span>
    </button>
  )
}

function LeadGuideContent() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="inline-flex items-center rounded-full bg-indigo-500 px-3 py-1 text-xs font-semibold text-white">
          Lead Workflow Guide
        </div>
        <h3 className="mt-4 text-2xl font-bold text-slate-900">CRM Instruction Guide</h3>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Quick flow</p>
            <h4 className="mt-2 text-lg font-semibold text-slate-900">Lead lifecycle</h4>
          </div>
          <p className="text-xs text-slate-500">Compact flow based on the same guide content</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {leadFlowSteps.map((step, index) => (
            <React.Fragment key={step}>
              <div className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-medium text-slate-700">
                {step}
              </div>
              {index < leadFlowSteps.length - 1 ? <span className="self-center text-slate-300">-&gt;</span> : null}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.9fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-900">1</div>
              <div>
                <h4 className="text-base font-semibold text-slate-900">Click on "Add Lead" Button</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Navigate to the Leads section and click <span className="font-semibold text-slate-900">Add Lead</span> to start creating a new lead.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-900">2</div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold text-slate-900">Search the Client Name</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Search for the client name first to verify whether a lead has already been generated for that client.
                </p>

                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-700">2A - Lead does not exist</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    If the lead has not been generated before, the system asks whether you want to create it for yourself or for another user.
                  </p>
                  <div className="mt-3 overflow-hidden rounded-xl border border-emerald-100 bg-white">
                    <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(0,1.6fr)] border-b border-emerald-100 bg-emerald-100/60 text-xs font-semibold text-slate-700">
                      <div className="px-3 py-2">Option</div>
                      <div className="px-3 py-2">When to choose</div>
                    </div>
                    <div className="grid grid-cols-[minmax(120px,0.8fr)_minmax(0,1.6fr)] text-sm text-slate-600">
                      <div className="border-b border-emerald-100 px-3 py-3 font-semibold text-slate-900">Self</div>
                      <div className="border-b border-emerald-100 px-3 py-3">Generate the lead under your own name.</div>
                      <div className="px-3 py-3 font-semibold text-slate-900">Other User</div>
                      <div className="px-3 py-3">Select the colleague and assign the lead to them.</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-700">2B - Lead already exists</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    If a lead for the client already exists, the user can either create a new lead for a different company or continue with special approval / add service.
                  </p>

                  <div className="mt-3 rounded-xl border border-amber-100 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">Option 1 - Create a New Lead Anyway</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      If the user selects Yes, a new lead can be created, but not under the same company name. If the user selects No, the system offers Special Approval or Add Service.
                    </p>
                  </div>

                  <div className="mt-3 rounded-xl border border-amber-100 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">2B.1 - Special Approval</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      When two users may be working on the same lead, the requesting user can submit a special approval claim with a reason and supporting documents. The Super Admin reviews the request and decides ownership.
                    </p>
                  </div>

                  <div className="mt-3 rounded-xl border border-amber-100 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900">2B.2 - Add Service to Existing Lead</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      If a lead already exists and the user wants to add another service, use <span className="font-semibold text-slate-900">Add Service</span> instead of creating a duplicate lead.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">Self:</span> Add the service under your own name.
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">Other User:</span> Select a user and add the service under their name.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-900">3</div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold text-slate-900">Fill Lead Details and Set Up Follow-Ups</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Once the lead details are completed, the lead should be actively followed up until it is closed.
                </p>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">3A - How to follow up</p>
                  <div className="mt-3 grid gap-2">
                    <div className="rounded-xl border border-white bg-white px-3 py-3 text-sm text-slate-700">1. Open the lead and click the eye icon to view details.</div>
                    <div className="rounded-xl border border-white bg-white px-3 py-3 text-sm text-slate-700">2. Go to the Follow-Up tab.</div>
                    <div className="rounded-xl border border-white bg-white px-3 py-3 text-sm text-slate-700">3. Add a follow-up by selecting the date and time.</div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Example: if the follow-up is set for 30/07/2026 at 12:00, reminders and escalation follow the timeline shown on the right.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-900">4</div>
              <div>
                <h4 className="text-base font-semibold text-slate-900">Close Lead and Assign to Manager</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  After closing the lead, the salesperson assigns it to their manager. The manager receives an email notification, reviews the lead, and assigns it to the appropriate staff member from the operations team.
                </p>
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-slate-700">
                  <span className="font-semibold text-emerald-800">Next step:</span> The operations team begins the client onboarding process and a kick-off meeting email is sent to the client.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-900">5</div>
              <div>
                <h4 className="text-base font-semibold text-slate-900">Claim Royalty (Cross-Year Lead Ownership)</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  If a lead was generated in one financial year and another user works with that same client in the next year for the same or a new service, the original user can submit a royalty claim after closure.
                </p>
                <div className="mt-4 grid gap-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">1. The original user sees the Claim button in the assignment section.</div>
                  <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">2. Clicking Claim sends a royalty request to the Super Admin.</div>
                  <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">3. The Super Admin decides whether royalty is granted and what percentage applies.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Reminder timeline</p>
            <h4 className="mt-2 text-lg font-semibold text-slate-900">Follow-up escalation</h4>
            <div className="mt-4 grid gap-3">
              {reminderTimeline.map((item) => (
                <div
                  key={item.title}
                  className={`rounded-2xl border p-4 text-sm leading-6 ${
                    item.tone === 'rose'
                      ? 'border-rose-200 bg-rose-50 text-slate-700'
                      : item.tone === 'amber'
                        ? 'border-amber-200 bg-amber-50 text-slate-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1">{item.description}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

export default function HelpYourself() {
  const [selected, setSelected] = useState('lead')

  const selectedCard = useMemo(() => helpCards.find((card) => card.key === selected), [selected])

  return (
    <DashboardShell currentUser={JSON.parse(localStorage.getItem('user') || 'null')}>
      <div className="min-h-[calc(100vh-72px)] bg-slate-50 px-3 py-5 sm:px-4 lg:px-5">
        <div className="w-full space-y-5">
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.35em] text-indigo-500">Help Yourself</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Choose a help topic</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Select a card and view the workflow from the CRM instruction guide in a tighter, easier-to-scan layout.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {helpCards.map((card) => (
                  <TopicCard
                    key={card.key}
                    card={card}
                    active={selected === card.key}
                    onClick={() => setSelected(card.key)}
                  />
                ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.35em] text-slate-500">Selected topic</p>
                <h2 className="mt-2 text-2xl font-black text-slate-900">{selectedCard?.title}</h2>
              </div>
              <div className="inline-flex rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 sm:text-sm">{selectedCard?.description}</div>
            </div>

            <div className="space-y-4">
              {selected === 'lead' ? (
                <div className="text-slate-700">
                  <LeadGuideContent />
                </div>
              ) : (
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-6 text-slate-700">
                  <p className="text-lg font-semibold text-slate-900">{selectedCard?.title} help content is coming soon.</p>
                  <p className="mt-3 max-w-2xl text-sm leading-6">A complete help guide for this workflow will be available here soon.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
