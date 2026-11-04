const path = require('path');
module.exports = {
  cacheDirectory: path.join(__dirname, 'backend', '.cache', 'puppeteer'),
  'chrome-headless-shell': { skipDownload: true }
};
