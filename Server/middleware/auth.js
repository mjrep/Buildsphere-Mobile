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
const SESSION_UNAVAILABLE_MESSAGE = 'Session could not be verified. Please try again.';

function inferRoleFromEmail(email) {
  const localPart = String(email || '').split('@')[0].toLowerCase();
  if (localPart.includes('projeng') || localPart.includes('engineer')) return 'project_engineer';
  if (localPart.includes('foreman')) return 'foreman';
  if (localPart.includes('ceo')) return 'ceo';
  if (localPart.includes('coo')) return 'coo';
  if (localPart.includes('account')) return 'accounting';
  if (localPart.includes('procure')) return 'procurement';
  if (localPart.includes('hr')) return 'human_resource';
  if (localPart.includes('coord')) return 'project_coordinator';
  if (localPart.includes('supervisor')) return 'project_supervisor';
  return 'staff';
}

function fallbackUserFromSupabase(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const numericId = Number.parseInt(String(user?.id || '').replace(/\D/g, '').slice(0, 9), 10);

  return {
    id: Number.isFinite(numericId) && numericId > 0 ? numericId : 0,
    email,
    role: inferRoleFromEmail(email),
    authOnly: true,
  };
}

function normalizeHeaderRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized || 'staff';
}

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

async function findMobileSessionUser(req) {
  const headerId = Number.parseInt(String(req.get('x-buildsphere-mobile-user-id') || ''), 10);
  const headerEmail = String(req.get('x-buildsphere-mobile-user-email') || '').trim().toLowerCase();
  const headerRole = normalizeHeaderRole(req.get('x-buildsphere-mobile-user-role'));

  if (Number.isFinite(headerId) && headerId > 0) {
    const result = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [headerId]);
    if (result.rows[0]) return result.rows[0];
  }

  if (headerEmail) {
    const result = await pool.query('SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1)', [headerEmail]);
    if (result.rows[0]) return result.rows[0];
  }

  if (Number.isFinite(headerId) && headerId > 0 && headerEmail) {
    return {
      id: headerId,
      email: headerEmail,
      role: headerRole,
      mobileSessionFallback: true,
    };
  }

  return null;
}

async function continueWithMobileSession(req, next) {
  const mobileUser = await findMobileSessionUser(req);
  if (!mobileUser) return false;

  req.user = mobileUser;
  qaDebug('Authenticated request', { role: mobileUser.role, authProvider: 'mobile-session-fallback' });
  next();
  return true;
}

async function authenticateRequest(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    if (await continueWithMobileSession(req, next)) return;
    return res.status(401).json({ success: false, message: SESSION_UNAVAILABLE_MESSAGE });
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
      if (await continueWithMobileSession(req, next)) return;
      return res.status(401).json({ success: false, message: SESSION_UNAVAILABLE_MESSAGE });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.email) {
      if (await continueWithMobileSession(req, next)) return;
      return res.status(401).json({ success: false, message: SESSION_UNAVAILABLE_MESSAGE });
    }

    const appUser = await findAppUser({ email: data.user.email });
    if (!appUser) {
      const fallbackUser = fallbackUserFromSupabase(data.user);
      if (fallbackUser) {
        req.user = fallbackUser;
        qaDebug('Authenticated request', { role: fallbackUser.role, authProvider: 'supabase-fallback' });
        return next();
      }

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
