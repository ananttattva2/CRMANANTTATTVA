const path = require('node:path');
const dotenv = require('dotenv');

module.exports = function loadEnv() {
  const result = dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
  if (result.error && result.error.code !== 'ENOENT') throw new Error('Backend .env could not be loaded');
  return result;
};
