// Never rewrite SRV discovery with hosts/replica sets from a previous cluster.
function mongoConfig(env = process.env) {
  const source = env.MONGO_URI ? 'MONGO_URI' : 'MONGO_ATLAS_URI';
  const uri = String(env[source] || '').trim();
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('Set a valid MONGO_URI');
  // Parse metadata only; pass the original encoded credentials to the driver.
  const withoutCredentials = uri.replace(/^(mongodb(?:\+srv)?:\/\/)(?:[^/]*@)/, '$1');
  const [authorityAndPath, query = ''] = withoutCredentials.split('?');
  const location = authorityAndPath.replace(/^mongodb(?:\+srv)?:\/\//, '');
  const slash = location.indexOf('/');
  const params = new URLSearchParams(query);
  const uriDb = slash < 0 ? '' : decodeURIComponent(location.slice(slash + 1));
  const dbName = String(env.DB_NAME || uriDb || 'crm').trim();
  const authSource = params.get('authSource') || env.MONGO_AUTH_SOURCE || 'admin';
  return { uri, dbName, authSource, diagnostics: {
    source, database: dbName, authSource,
    srv: uri.startsWith('mongodb+srv://'),
    legacyDirectHostsIgnored: Boolean(env.MONGO_DIRECT_HOSTS),
    legacyReplicaSetIgnored: Boolean(env.MONGO_REPLICA_SET),
    alternateUriIgnored: source === 'MONGO_URI' && Boolean(env.MONGO_ATLAS_URI)
  } };
}

function safeMongoError(error) {
  // Driver messages/topology/cause may include credentials. Allowlist metadata.
  return { category: error?.code === 18 ? 'authentication' : 'connection-or-initialization',
    code: typeof error?.code === 'number' ? error.code : undefined };
}

module.exports = { mongoConfig, buildMongoUri: () => mongoConfig().uri, safeMongoError };
