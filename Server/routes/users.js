/**
 * Users routes
 *
 * Authenticated profile/user APIs. Self-service profile updates are separated from
 * role/status administration so users cannot change their own permissions.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { authenticateRequest } = require('../middleware/auth');
const { canEditUserRoles } = require('../rbac');
let userProfileSchemaReady = false;
let supabaseAuthClient = null;
let supabaseDataClient = null;

const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const profilePhotoRoot = path.join(__dirname, '../uploads/profile_photos');

fs.mkdirSync(profilePhotoRoot, { recursive: true });

function profilePhotoExtension(mimetype) {
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}

function isLocalProfilePhotoForUser(photoUrl, userId) {
  const normalizedUrl = String(photoUrl || '').replace(/\\/g, '/');
  return normalizedUrl.startsWith(`/uploads/profile_photos/${userId}/`);
}

function deleteLocalProfilePhoto(photoUrl, userId) {
  if (!isLocalProfilePhotoForUser(photoUrl, userId)) return;

  const relativePath = String(photoUrl).replace(/^\/uploads\//, '');
  const absolutePath = path.resolve(__dirname, '../uploads', relativePath);
  const userPhotoDir = path.resolve(profilePhotoRoot, String(userId));

  if (!absolutePath.startsWith(userPhotoDir + path.sep)) return;

  fs.promises.unlink(absolutePath).catch((error) => {
    if (error.code !== 'ENOENT') {
      console.warn('PROFILE_PHOTO_DELETE_WARNING:', error.message || error);
    }
  });
}

const profilePhotoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userDir = path.join(profilePhotoRoot, String(req.user.id));
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `avatar-${Date.now()}${profilePhotoExtension(file.mimetype)}`);
  },
});

const uploadProfilePhoto = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: PROFILE_PHOTO_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!PROFILE_PHOTO_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Unsupported image type.'));
    }
    return cb(null, true);
  },
});
const uploadProfilePhotoFile = uploadProfilePhoto.single('photo');

function handleProfilePhotoUpload(req, res, next) {
  uploadProfilePhotoFile(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Profile photo must be smaller than 5 MB.' });
    }

    return res.status(400).json({ error: error.message || 'Invalid profile photo upload.' });
  });
}

function normalizeDateOnly(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : value;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

function mapUserProfile(user) {
  return {
    id: user.id,
    firstName: user.first_name,
    middleName: user.middle_name,
    lastName: user.last_name,
    suffix: user.suffix,
    email: user.email,
    role: user.role || 'staff',
    phoneNumber: user.phone_number,
    gender: user.gender,
    birthdate: normalizeDateOnly(user.birthdate),
    address: user.address,
    department: user.department,
    position: user.position,
    accountStatus: user.account_status,
    profilePictureUrl: user.profile_picture_url,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function getSupabaseAuthClient() {
  if (supabaseAuthClient) return supabaseAuthClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;

  supabaseAuthClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return supabaseAuthClient;
}

function getSupabaseDataClient() {
  if (supabaseDataClient) return supabaseDataClient;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!process.env.SUPABASE_URL || !key) return null;

  supabaseDataClient = createClient(process.env.SUPABASE_URL, key);
  return supabaseDataClient;
}

function getBearerToken(req) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function getVerifiedSupabaseEmail(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  const supabase = getSupabaseAuthClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) return null;

  return String(data.user.email).trim().toLowerCase();
}

function inferDemoRoleFromEmail(email) {
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
  return 'general_staff';
}

function inferNameFromEmail(email) {
  const localPart = String(email || '').split('@')[0] || 'user';
  const readable = localPart
    .replace(/[_-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .trim();
  const words = readable ? readable.split(/\s+/) : ['BuildSphere', 'User'];
  const title = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

  if (title.length === 1) {
    const compact = title[0];
    if (/projeng/i.test(compact)) return { firstName: 'Project', lastName: 'Engineer' };
    return { firstName: compact, lastName: 'User' };
  }

  return { firstName: title[0], lastName: title.slice(1).join(' ') };
}

async function findBasicUserProfileByEmail(email) {
  const result = await pool.query(
    `SELECT
      id,
      first_name,
      last_name,
      email,
      role
    FROM users
    WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  return result.rows[0] || null;
}

async function findUserProfileByEmailWithSupabase(email) {
  const supabase = getSupabaseDataClient();
  if (!supabase) return null;

  const fullColumns = `
    id,
    first_name,
    middle_name,
    last_name,
    suffix,
    email,
    role,
    phone_number,
    gender,
    birthdate,
    address,
    department,
    position,
    account_status,
    profile_picture_url,
    created_at,
    updated_at
  `;
  const basicColumns = 'id, first_name, last_name, email, role';

  const fullResult = await supabase.from('users').select(fullColumns).ilike('email', email).maybeSingle();
  if (!fullResult.error) return fullResult.data || null;

  console.warn('SUPABASE_PROFILE_FULL_LOOKUP_WARNING:', fullResult.error.message || fullResult.error);
  const basicResult = await supabase.from('users').select(basicColumns).ilike('email', email).maybeSingle();
  if (basicResult.error) throw basicResult.error;
  return basicResult.data || null;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidPhone(value) {
  if (!value) return true;
  return /^[+()\-\d\s]{7,20}$/.test(String(value).trim());
}

function isValidBirthdate(value) {
  if (!value) return true;
  const normalized = normalizeDateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized || '')) return false;

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return parsed <= todayUtc;
}

function canAccessUser(req, targetUserId) {
  return String(req.user?.id || '') === String(targetUserId || '') || canEditUserRoles(req.user?.role);
}

function requireUserAccess(req, res, next) {
  if (!canAccessUser(req, req.params.id)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to access this user profile.' });
  }

  return next();
}

async function ensureUserProfileColumns() {
  if (userProfileSchemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      first_name VARCHAR(120) NOT NULL DEFAULT 'BuildSphere',
      last_name VARCHAR(120) NOT NULL DEFAULT 'User',
      email VARCHAR(255) NOT NULL UNIQUE,
      password TEXT,
      role VARCHAR(80) NOT NULL DEFAULT 'general_staff'
    )
  `);
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS middle_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS suffix VARCHAR(50),
      ADD COLUMN IF NOT EXISTS phone_number VARCHAR(40),
      ADD COLUMN IF NOT EXISTS gender VARCHAR(40),
      ADD COLUMN IF NOT EXISTS birthdate DATE,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS department VARCHAR(120),
      ADD COLUMN IF NOT EXISTS position VARCHAR(120),
      ADD COLUMN IF NOT EXISTS account_status VARCHAR(30) DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
  `);
  userProfileSchemaReady = true;
}

async function findOrCreateVerifiedSupabaseProfile(req, email) {
  const verifiedEmail = await getVerifiedSupabaseEmail(req);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!verifiedEmail || verifiedEmail !== normalizedEmail) return null;

  const existingSupabaseProfile = await findUserProfileByEmailWithSupabase(normalizedEmail).catch((error) => {
    console.warn('SUPABASE_PROFILE_LOOKUP_WARNING:', error.message || error);
    return null;
  });
  if (existingSupabaseProfile) return existingSupabaseProfile;

  const { firstName, lastName } = inferNameFromEmail(normalizedEmail);
  const role = inferDemoRoleFromEmail(normalizedEmail);
  const supabase = getSupabaseDataClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .insert({
        first_name: firstName,
        last_name: lastName,
        email: normalizedEmail,
        role,
        account_status: 'active',
      })
      .select(`
        id,
        first_name,
        middle_name,
        last_name,
        suffix,
        email,
        role,
        phone_number,
        gender,
        birthdate,
        address,
        department,
        position,
        account_status,
        profile_picture_url,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (!error && data) return data;
    if (error) console.warn('SUPABASE_PROFILE_REPAIR_WARNING:', error.message || error);
  }

  const result = await pool.query(
    `INSERT INTO users (first_name, last_name, email, role, account_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
     ON CONFLICT (email) DO UPDATE
       SET updated_at = NOW()
     RETURNING
       id,
       first_name,
       middle_name,
       last_name,
       suffix,
       email,
       role,
       phone_number,
       gender,
       birthdate,
       address,
       department,
       position,
       account_status,
       profile_picture_url,
       created_at,
       updated_at`,
    [firstName, lastName, normalizedEmail, role]
  );

  return result.rows[0] || null;
}

// GET /users - list all users
router.get('/', authenticateRequest, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, first_name, last_name, email FROM users ORDER BY first_name ASC'
    );
    res.json(
      result.rows.map((u) => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`,
        email: u.email,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// GET /users/by-email/:email - fetch app profile for a Supabase Auth user
router.get('/by-email/:email', async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const result = await pool.query(
      `SELECT
        id,
        first_name,
        middle_name,
        last_name,
        suffix,
        email,
        role,
        phone_number,
        gender,
        birthdate,
        address,
        department,
        position,
        account_status,
        profile_picture_url,
        created_at,
        updated_at
      FROM users
      WHERE LOWER(email) = LOWER($1)`,
      [req.params.email]
    );

    if (result.rows.length === 0) {
      const repairedProfile = await findOrCreateVerifiedSupabaseProfile(req, req.params.email);
      if (repairedProfile) return res.json(mapUserProfile(repairedProfile));
      return res.status(404).json({ error: 'User profile not found.' });
    }

    res.json(mapUserProfile(result.rows[0]));
  } catch (err) {
    console.error('USER_PROFILE_LOOKUP_ERROR:', err.message || err);

    try {
      const supabaseProfile = await findUserProfileByEmailWithSupabase(req.params.email);
      if (supabaseProfile) return res.json(mapUserProfile(supabaseProfile));

      const basicUser = await findBasicUserProfileByEmail(req.params.email);
      if (!basicUser) {
        const repairedProfile = await findOrCreateVerifiedSupabaseProfile(req, req.params.email);
        if (repairedProfile) return res.json(mapUserProfile(repairedProfile));
        return res.status(404).json({ error: 'User profile not found.' });
      }

      return res.json(mapUserProfile(basicUser));
    } catch (fallbackError) {
      console.error('USER_PROFILE_FALLBACK_ERROR:', fallbackError.message || fallbackError);
      return res.status(500).json({ error: 'Server error.' });
    }
  }
});

// POST /users/me/profile-photo - upload/change the authenticated user's profile photo
router.post('/me/profile-photo', authenticateRequest, handleProfilePhotoUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No profile photo uploaded.' });

  try {
    await ensureUserProfileColumns();
    const userId = req.user.id;
    const previousResult = await pool.query('SELECT profile_picture_url FROM users WHERE id = $1', [userId]);
    const previousUrl = previousResult.rows[0]?.profile_picture_url || null;
    const profilePhotoUrl = `/uploads/profile_photos/${userId}/${req.file.filename}`;

    await pool.query('UPDATE users SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2', [
      profilePhotoUrl,
      userId,
    ]);

    deleteLocalProfilePhoto(previousUrl, userId);

    res.json({
      success: true,
      profile_photo_url: profilePhotoUrl,
      profilePictureUrl: profilePhotoUrl,
    });
  } catch (err) {
    console.error('PROFILE_PHOTO_UPLOAD_ERROR:', err);
    res.status(500).json({ error: 'Could not update profile photo. Please try again.' });
  }
});

// DELETE /users/me/profile-photo - remove the authenticated user's profile photo
router.delete('/me/profile-photo', authenticateRequest, async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const userId = req.user.id;
    const previousResult = await pool.query('SELECT profile_picture_url FROM users WHERE id = $1', [userId]);
    const previousUrl = previousResult.rows[0]?.profile_picture_url || null;

    await pool.query('UPDATE users SET profile_picture_url = NULL, updated_at = NOW() WHERE id = $1', [userId]);
    deleteLocalProfilePhoto(previousUrl, userId);

    res.json({
      success: true,
      profile_photo_url: null,
      profilePictureUrl: null,
    });
  } catch (err) {
    console.error('PROFILE_PHOTO_REMOVE_ERROR:', err);
    res.status(500).json({ error: 'Could not remove profile photo. Please try again.' });
  }
});

// PATCH /users/me/profile - update the authenticated user's editable profile fields
router.patch('/me/profile', authenticateRequest, async (req, res) => {
  // NOTE: Self-service profile updates exclude role/status so users cannot change permissions.
  const {
    firstName,
    middleName,
    lastName,
    suffix,
    email,
    phoneNumber,
    gender,
    birthdate,
    address,
    profilePictureUrl,
  } = req.body || {};

  const trimmedFirstName = String(firstName || '').trim();
  const trimmedLastName = String(lastName || '').trim();
  const trimmedEmail = String(email || '').trim();
  const normalizedBirthdate = normalizeDateOnly(birthdate);

  if (!trimmedFirstName || !trimmedLastName) {
    return res.status(400).json({ success: false, message: 'First and last name are required.' });
  }

  if (!isValidEmail(trimmedEmail)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  if (!isValidPhone(phoneNumber)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
  }

  if (!isValidBirthdate(birthdate)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid birthdate.' });
  }

  try {
    await ensureUserProfileColumns();
    const profilePictureSql = profilePictureUrl !== undefined ? profilePictureUrl : null;
    const result = await pool.query(
      `UPDATE users
       SET
         first_name = $1,
         middle_name = $2,
         last_name = $3,
         suffix = $4,
         email = $5,
         phone_number = $6,
         gender = $7,
         birthdate = $8,
         address = $9,
         profile_picture_url = COALESCE($10, profile_picture_url),
         updated_at = NOW()
       WHERE id = $11
       RETURNING
         id, first_name, middle_name, last_name, suffix, email, role,
         phone_number, gender, birthdate, address, department, position,
         account_status, profile_picture_url, created_at, updated_at`,
      [
        trimmedFirstName,
        middleName ? String(middleName).trim() : null,
        trimmedLastName,
        suffix ? String(suffix).trim() : null,
        trimmedEmail,
        phoneNumber ? String(phoneNumber).trim() : null,
        gender ? String(gender).trim() : null,
        normalizedBirthdate,
        address ? String(address).trim() : null,
        profilePictureSql,
        req.user.id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }

    res.json({ success: true, user: mapUserProfile(result.rows[0]) });
  } catch (err) {
    console.error('PROFILE_UPDATE_ERROR:', err);
    res.status(500).json({ success: false, message: 'Could not update profile. Please try again.' });
  }
});

// GET /users/:id
router.get('/:id', authenticateRequest, requireUserAccess, async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const result = await pool.query(
      `SELECT
        id,
        first_name,
        middle_name,
        last_name,
        suffix,
        email,
        role,
        phone_number,
        gender,
        birthdate,
        address,
        department,
        position,
        account_status,
        profile_picture_url,
        created_at,
        updated_at
      FROM users
      WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(mapUserProfile(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /users/:id/profile  — update name & photo
router.patch('/:id/profile', authenticateRequest, requireUserAccess, async (req, res) => {
  const {
    firstName,
    middleName,
    lastName,
    suffix,
    phoneNumber,
    gender,
    birthdate,
    address,
    department,
    position,
    profilePictureUrl,
  } = req.body;
  try {
    await ensureUserProfileColumns();
    const profilePictureSql = profilePictureUrl !== undefined ? profilePictureUrl : null;
    const result = await pool.query(
      `UPDATE users
       SET
         first_name = $1,
         middle_name = $2,
         last_name = $3,
         suffix = $4,
         phone_number = $5,
         gender = $6,
         birthdate = $7,
         address = $8,
         department = $9,
         position = $10,
         profile_picture_url = COALESCE($11, profile_picture_url),
         updated_at = NOW()
       WHERE id = $12
       RETURNING
         id, first_name, middle_name, last_name, suffix, email, role,
         phone_number, gender, birthdate, address, department, position,
         account_status, profile_picture_url, created_at, updated_at`,
      [
        firstName,
        middleName || null,
        lastName,
        suffix || null,
        phoneNumber || null,
        gender || null,
        normalizeDateOnly(birthdate),
        address || null,
        department || null,
        position || null,
        profilePictureSql,
        req.params.id,
      ]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      id: user.id,
      firstName: user.first_name,
      middleName: user.middle_name,
      lastName: user.last_name,
      suffix: user.suffix,
      email: user.email,
      role: user.role,
      phoneNumber: user.phone_number,
      gender: user.gender,
      birthdate: normalizeDateOnly(user.birthdate),
      address: user.address,
      department: user.department,
      position: user.position,
      accountStatus: user.account_status,
      profilePictureUrl: user.profile_picture_url,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// PATCH /users/:id/account  — update email and/or password
router.patch('/:id/account', authenticateRequest, requireUserAccess, async (req, res) => {
  // NOTE: Account credential updates are separate from profile edits.
  const { email, password } = req.body;
  try {
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET email = $1, password = $2, password_hash = $2 WHERE id = $3', [
        email,
        hashed,
        req.params.id,
      ]);
    } else {
      await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update account.' });
  }
});

// PATCH /users/:id/push-token — save Expo Push Token
router.patch('/:id/push-token', authenticateRequest, requireUserAccess, async (req, res) => {
  const { pushToken } = req.body;
  try {
    await pool.query('UPDATE users SET push_token = $1 WHERE id = $2', [
      pushToken,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save push token.' });
  }
});

module.exports = router;
