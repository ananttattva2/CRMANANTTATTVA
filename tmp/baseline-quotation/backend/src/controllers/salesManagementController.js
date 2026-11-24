const { getSalesManagementDashboard } = require('../services/salesManagementDashboard');

exports.managementDashboard = async (req, res) => {
  try {
    const dashboard = await getSalesManagementDashboard({
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      department: req.query.department,
      managerId: req.query.managerId,
      interval: req.query.interval || 'monthly',
      includeLeadDetails: String(req.query.includeLeadDetails || '').toLowerCase() === 'true',
      requester: req.user
    });
    res.json(dashboard);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Unable to load the sales management dashboard.' });
  }
};
