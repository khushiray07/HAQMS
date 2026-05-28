const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    if (!JWT_SECRET) {
      console.error('JWT_SECRET is not configured.');
      return res.status(500).json({ error: 'Authentication service is not configured.' });
    }

    // SECURITY BUG: The verification is weak. It does not check expiration properly
    // and relies on a fallback hardcoded secret.
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Add user details to request object
    req.user = decoded;
    next();
  } catch (error) {
    // IMPROPER ERROR HANDLING: Leaks full error details including secret key mismatches to the client
    return res.status(401).json({ error: 'Invalid token.', details: error.message });
  }
};

// Role authorization middleware
const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. User context missing.' });
    }

    // Role-based verification
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden. Requires role: ${roles.join(' or ')}` });
    }

    next();
  };
};

// MISSING AUTHORIZATION CHECK: This middleware is meant for Admin actions but is empty
// or fails to check the role, allowing any authenticated user (e.g. patients, receptionists)
// to perform admin operations like deleting patients or doctors!
const authorizeAdminOnlyLegacy = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admin only.' });
  }
  next();
};

module.exports = {
  authenticate,
  authorize,
  authorizeAdminOnlyLegacy,
};
