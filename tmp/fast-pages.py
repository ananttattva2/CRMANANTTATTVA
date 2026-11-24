from pathlib import Path
p=Path('frontend/src/pages/PendingApproval.jsx');s=p.read_text(encoding='utf-8');start=s.index('      const [duplicateResult] = await duplicatePromise;');end=s.index('\n    } catch (err)',start);block=s[start:end];block=block.replace('      const [duplicateResult] = await duplicatePromise;','''      const applyLeadFeed = ([duplicateResult]) => {
      if (duplicateResult.status !== 'fulfilled') {
        if (requestId === loadRequestRef.current) setError(readError(duplicateResult.reason, 'Unable to refresh PO and special approvals. Please retry.'));
        return;
      }''')+'\n      };\n      const leadFeed = duplicatePromise.then(applyLeadFeed);'
s=s[:start]+ '      await leadFeed;'+s[end:];insert=s.index('      const [meResult, approvalsResult]');s=s[:insert]+block+'\n'+s[insert:];p.write_text(s,encoding='utf-8')
p=Path('frontend/src/pages/LeadGeneration.jsx');s=p.read_text(encoding='utf-8');start=s.index('      const [meResponse, usersResult, crmLeadsResponse] = await Promise.all([');end=s.index('      const crmLeads =',start)
s=s[:start]+'''      // Each result is applied as soon as it is ready. Staff avatars/profile
      // reads must not delay the paginated lead table.
      const meRequest = api.get(API_ENDPOINTS.auth.me).then(response => {
        if (requestId === leadListRequestRef.current) setCurrentUser(response.data.user);
        return response.data.user;
      }).catch(() => null);
      void api.get(API_ENDPOINTS.leads.assignmentUsers, { params: { view: 'directory' } }).then(response => {
        if (requestId === leadListRequestRef.current) setStaff(response.data.users || []);
      }).catch(async () => {
        const me = await meRequest;
        if (requestId === leadListRequestRef.current && me) setStaff([me]);
      });
      const crmLeadsResponse = await api.get(API_ENDPOINTS.leads.list, { params: { paginated: true, directory: true, page: 1, limit: 10, workspace: initialWorkspace } });
      if (requestId !== leadListRequestRef.current) return;
'''+s[end:];p.write_text(s,encoding='utf-8')
p=Path('backend/src/controllers/leadController.js');s=p.read_text(encoding='utf-8').replace('exports.listAssignmentUsers = async (_req, res) => {', 'exports.listAssignmentUsers = async (req, res) => {').replace(".select('crmUserId name email avatarUrl role roles team teamId managerId operationHeadId isActive')", ".select(req.query.view === 'directory' ? 'crmUserId name email role roles team teamId managerId operationHeadId isActive' : 'crmUserId name email avatarUrl role roles team teamId managerId operationHeadId isActive')");p.write_text(s,encoding='utf-8')
