const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { isPasswordResetEmailConfigured, sendPasswordResetOtp } = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'buildsphere_dev_secret_key');
const OTP_EXPIRY_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 6;
const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

function signAuthToken(user) {
  if (!JWT_SECRET) {
    throw new Error('Missing JWT_SECRET environment variable.');
  }

  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function logDevResetOtp(email, otp) {
  if (process.env.LOG_RESET_OTP !== 'true') return;
  console.log(`[DEV] Password reset OTP generated for ${email}: ${otp}`);
}

function canUseDevResetOtpLog() {
  return process.env.LOG_RESET_OTP === 'true' && process.env.NODE_ENV !== 'production';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isExpiredToken(row) {
  const tokenTime = new Date(row.created_at).getTime();
  return Date.now() - tokenTime > OTP_EXPIRY_MS;
}

async function findSupabaseUserIdByEmail(email) {
  if (!supabaseAdmin) {
    throw new Error('Missing Supabase service-role config.');
  }

  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user.id;
    if (data.users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function validateResetOtp(email, otp) {
  const result = await pool.query('SELECT * FROM password_reset_tokens WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email]);
  const tokenRow = result.rows[0];

  if (!tokenRow) return { valid: false, expired: false };
  if (isExpiredToken(tokenRow)) {
    await pool.query('DELETE FROM password_reset_tokens WHERE email = $1', [email]);
    return { valid: false, expired: true };
  }

  const storedToken = String(tokenRow.token || '');
  const valid = storedToken.startsWith('$2')
    ? await bcrypt.compare(otp, storedToken)
    : otp === storedToken;

  return { valid, expired: false };
}

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM "public"."users" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO "public"."users" (first_name, last_name, email, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, first_name, last_name, email',
      [firstName, lastName, email, hashed, 'user']
    );
    const user = result.rows[0];
    const token = signAuthToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role || 'staff',
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const result = await pool.query('SELECT * FROM "public"."users" WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'No account found with that email.' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    const token = signAuthToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role || 'staff',
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// POST /auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  if (!isPasswordResetEmailConfigured() && !canUseDevResetOtpLog()) {
    return res.status(503).json({
      error: 'Password reset email is not configured. Set SMTP_USER and SMTP_PASS on the server.',
    });
  }

  try {
    const userResult = await pool.query('SELECT id FROM "public"."users" WHERE LOWER(email) = LOWER($1)', [email]);
    if (userResult.rows.length === 0) {
      return res.json({ success: true, message: 'If registered, an OTP was sent.' });
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);

    await pool.query('DELETE FROM password_reset_tokens WHERE email = $1', [email]);
    await pool.query('INSERT INTO password_reset_tokens (email, token, created_at) VALUES ($1, $2, NOW())', [email, hashedOtp]);

    if (isPasswordResetEmailConfigured()) {
      await sendPasswordResetOtp(email, otp);
    }
    logDevResetOtp(email, otp);

    res.json({
      success: true,
      message: 'If registered, an OTP was sent.',
      devOtp: canUseDevResetOtpLog() ? otp : undefined,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during password reset request.' });
  }
});

// POST /auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  if (!email || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Enter the 6-digit OTP sent to your email.' });
  }

  try {
    const otpResult = await validateResetOtp(email, otp);
    if (!otpResult.valid) {
      if (otpResult.expired) return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
      return res.status(400).json({ error: 'Invalid or expired OTP.' });
    }

    res.json({ success: true, message: 'OTP verified.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error during OTP verification.' });
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  const newPassword = String(req.body.newPassword || '');

  if (!email || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Enter the 6-digit OTP sent to your email.' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  try {
    const otpResult = await validateResetOtp(email, otp);
    if (!otpResult.valid) {
      if (otpResult.expired) return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
      return res.status(400).json({ error: 'Invalid or expired OTP.' });
    }

    const authUserId = await findSupabaseUserIdByEmail(email);
    if (!authUserId) {
      return res.status(400).json({ error: 'No authentication account is linked to this email.' });
    }

    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      password: newPassword,
    });
    if (updateAuthError) throw updateAuthError;

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE "public"."users" SET password = $1 WHERE LOWER(email) = LOWER($2)', [hashed, email]);
    await pool.query('DELETE FROM password_reset_tokens WHERE email = $1', [email]);

    res.json({ success: true, message: 'Password has been successfully reset.' });
  } catch (err) {
    console.error('RESET_PASSWORD_ERROR:', err);
    res.status(500).json({ error: 'Server error during password reset.' });
  }
});

module.exports = router;
