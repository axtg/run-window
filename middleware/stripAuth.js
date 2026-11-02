const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie']);

// Backup for nginx (which blanks both headers): remove credentials before anything can log or echo them.
function stripAuth(req, res, next) {
  for (const name of CREDENTIAL_HEADERS) delete req.headers[name];

  const kept = [];
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    if (!CREDENTIAL_HEADERS.has(req.rawHeaders[i].toLowerCase())) kept.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  req.rawHeaders = kept;

  next();
}

module.exports = stripAuth;
