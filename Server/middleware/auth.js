/**
 * Auth middleware
 *
 * Verifies the mobile access token and attaches the authenticated user to req.user
 * before protected routes apply route-specific RBAC and business rules.
 */
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const pool = require('../db');
const { qaDebug } = require('../services/qaDebug');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'buildsphere_dev_secret_key');
let supabaseAuthClient = null;

function getSupabaseAuthClient() {
  if (supabaseAuthClient) return supabaseAuthClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;

  supabaseAuthClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return supabaseAuthClient;
}

function getBearerToken(req) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function findAppUser(payload) {
  if (payload?.userId) {
    const result = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [payload.userId]);
    if (result.rows[0]) return result.rows[0];
  }

  if (payload?.email) {
    const result = await pool.query('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1)', [payload.email]);
    if (result.rows[0]) return result.rows[0];
  }

  return null;
}

async function authenticateRequest(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication is required.' });
  }

  try {
    if (JWT_SECRET) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const appUser = await findAppUser(payload);
        if (appUser) {
          req.user = appUser;
          qaDebug('Authenticated request', { role: appUser.role, authProvider: 'jwt' });
          return next();
        }
      } catch (jwtError) {
        // Fall through to Supabase token validation.
      }
    }

    const supabase = getSupabaseAuthClient();
    if (!supabase) {
      return res.status(401).json({ success: false, message: 'Authentication is required.' });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.email) {
      return res.status(401).json({ success: false, message: 'Authentication is required.' });
    }

    const appUser = await findAppUser({ email: data.user.email });
    if (!appUser) {
      return res.status(403).json({ success: false, message: 'User profile is not available.' });
    }

    req.user = appUser;
    qaDebug('Authenticated request', { role: appUser.role, authProvider: 'supabase' });
    return next();
  } catch (error) {
    console.error('AUTH_MIDDLEWARE_ERROR:', error.message || error);
    return res.status(500).json({ success: false, message: 'Could not verify authentication.' });
  }
}

module.exports = {
  authenticateRequest,
};
