const test=require('node:test'),assert=require('node:assert/strict');
const {buildUserProductivityReport}=require('../src/services/userProductivityReport');
const {readReportActivities,activitySummaryPipeline}=require('../src/services/reportActivitySummary');
test('aggregated telemetry preserves action totals, India daily timelines and the latest twelve real actions',async()=>{
 const raw=Array.from({length:80},(_,i)=>({_id:`event-${i}`,userId:'user-one',action:'UPDATED',module:i%2?'leads':'clients',description:`Change ${i}`,occurredAt:new Date(Date.UTC(2026,10,13,17,0,i*120))})).sort((a,b)=>b.occurredAt-a.occurredAt);
 const groups=new Map();for(const row of raw){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(row.occurredAt);const key=day+row.module;const item=groups.get(key)||{_id:{userId:row.userId,module:row.module},occurredAt:row.occurredAt,count:0};item.count++;groups.set(key,item);}
 const Model={aggregate(){return{option:async()=>[{daily:[...groups.values()],recent:[{rows:raw.slice(0,12)}]}]};}};
 const compact=await readReportActivities(Model,{});const base={users:[{_id:'user-one',name:'User',isActive:true}],sessions:[],leads:[],clients:[],ticketStats:[],period:{from:'2026-11-13',to:'2026-11-14'}};
 const full=buildUserProductivityReport({...base,activities:raw}),summary=buildUserProductivityReport({...base,activities:compact});
 assert.equal(summary.summary.actions,80);assert.deepEqual(summary.users[0].timeline,full.users[0].timeline);assert.deepEqual(summary.users[0].recentActions,full.users[0].recentActions);assert.equal(String(summary.users[0].lastActivity),String(full.users[0].lastActivity));assert.ok(compact.length<raw.length/2);
});
test('telemetry aggregation casts scoped user IDs and bounds the source before grouping',()=>{const id='64b000000000000000000001';const pipeline=activitySummaryPipeline({userId:{$in:[id]},occurredAt:{$gte:new Date('2026-11-01')}});assert.equal(pipeline[0].$match.userId.$in[0].toHexString(),id);assert.equal(pipeline[2].$limit,10000);assert.equal(pipeline[4].$facet.recent[0].$group.rows.$firstN.n,12);});

test('session summaries preserve presence, device, active/away seconds and daily history without double counting',async()=>{
 const {readReportSessions}=require('../src/services/reportActivitySummary');
 const sessions=[
  {userId:'user-one',loginAt:new Date('2026-11-13T04:00:00Z'),lastActivityAt:new Date('2026-11-13T05:00:00Z'),logoutAt:new Date('2026-11-13T05:05:00Z'),activeSeconds:3000,activityCount:5},
  {userId:'user-one',loginAt:new Date('2026-11-13T06:00:00Z'),lastActivityAt:new Date('2026-11-13T06:10:00Z'),activeSeconds:800,activityCount:2},
  {userId:'user-one',loginAt:new Date('2026-11-14T04:00:00Z'),lastActivityAt:new Date('2026-11-14T04:05:00Z'),activeSeconds:200,activityCount:3,presenceState:'active',ipAddress:'127.0.0.1',userAgent:'Test browser'}
 ];
 const groups=new Map();for(const row of sessions){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(row.loginAt);const end=row.logoutAt||row.lastActivityAt||row.loginAt,open=Math.max(0,Math.round((end-row.loginAt)/1000));const value=groups.get(day)||{_id:{userId:row.userId},loginAt:row.loginAt,lastActivityAt:row.lastActivityAt,logoutAt:end,activeSeconds:0,openSeconds:0,awaySeconds:0,activityCount:0};value.loginAt=value.loginAt<row.loginAt?value.loginAt:row.loginAt;value.lastActivityAt=value.lastActivityAt>row.lastActivityAt?value.lastActivityAt:row.lastActivityAt;value.logoutAt=value.logoutAt>end?value.logoutAt:end;value.activeSeconds+=row.activeSeconds;value.openSeconds+=open;value.awaySeconds+=Math.max(0,open-row.activeSeconds);value.activityCount+=row.activityCount;groups.set(day,value);}
 const Model={aggregate(){return{option:async()=>[{daily:[...groups.values()].map(row=>({values:[row._id.userId,row.loginAt,row.lastActivityAt,row.logoutAt,row.activeSeconds,row.openSeconds,row.awaySeconds,row.activityCount]})),latest:[{rows:[sessions[2]]}]}]};}};const compact=await readReportSessions(Model,{});
 const base={users:[{_id:'user-one',name:'User',isActive:true,lastLogin:new Date('2026-11-14T04:00:00Z')}],activities:[],leads:[],clients:[],ticketStats:[],period:{from:'2026-11-13',to:'2026-11-14'},now:new Date('2026-11-14T04:06:00Z')};
 const full=buildUserProductivityReport({...base,sessions}),summary=buildUserProductivityReport({...base,sessions:compact});assert.deepEqual(summary,full);
});
