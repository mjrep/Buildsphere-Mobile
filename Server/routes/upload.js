/* global __dirname */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { authenticateRequest } = require('../middleware/auth');

const PROFILE_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `user_${req.params.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!PROFILE_PHOTO_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Unsupported image type.'));
    }
    return cb(null, true);
  },
});

function requireOwnUpload(req, res, next) {
  if (String(req.user?.id || '') !== String(req.params.id || '')) {
    return res.status(403).json({ error: 'You do not have permission to update this profile photo.' });
  }

  return next();
}

function handleProfilePhotoUpload(req, res, next) {
  upload.single('photo')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Profile photo must be smaller than 5 MB.' });
    }

    return res.status(400).json({ error: error.message || 'Invalid profile photo upload.' });
  });
}

// POST /upload/:id/photo
router.post('/:id/photo', authenticateRequest, requireOwnUpload, handleProfilePhotoUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const imageUrl = `/uploads/${req.file.filename}`;
    await pool.query('UPDATE users SET profile_picture_url = $1 WHERE id = $2', [
      imageUrl,
      req.params.id,
    ]);
    res.json({ imageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save photo.' });
  }
});

module.exports = router;
