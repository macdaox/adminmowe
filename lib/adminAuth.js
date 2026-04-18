function getAdminToken() {
  const token = process.env.ADMIN_TOKEN;
  if (token && token.trim()) return token.trim();
  return 'dev-admin-token';
}

function adminAuth(req, res, next) {
  const expected = getAdminToken();
  const got = req.header('x-admin-token') || '';
  if (got === expected) return next();
  res.status(401).json({ error: 'unauthorized' });
}

module.exports = {
  getAdminToken,
  adminAuth
};

