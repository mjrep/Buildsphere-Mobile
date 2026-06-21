/* global __dirname */
const express = require('express');
const cors = require('cors');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const authRoutes = require('./routes/auth');
const projectsRoutes = require('./routes/projects');
const tasksRoutes = require('./routes/tasks');
const notificationsRoutes = require('./routes/notifications');
const usersRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const siteProgressRoutes = require('./routes/siteProgress');
const inventoryRoutes = require('./routes/inventory');
const aiRoutes = require('./routes/ai');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
}));
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const message = body.message || body.error || 'Request failed.';
      return originalJson({
        success: false,
        ...body,
        message,
      });
    }

    return originalJson(body);
  };

  next();
});
app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON request body.' });
  }

  next(err);
});
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/auth', authRoutes);
app.use('/projects', projectsRoutes);
app.use('/tasks', tasksRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/users', usersRoutes);
app.use('/upload', uploadRoutes);
app.use('/site-progress', siteProgressRoutes);
app.use('/inventory', inventoryRoutes);
app.use('/api/ai', aiRoutes);
// Phase 2 spec path: /api/projects/:projectId/inventory
app.use('/api/projects/:projectId/inventory', (req, res, next) => {
  // Inject projectId into query for route handlers that expect it
  req.query.projectId = req.query.projectId || req.params.projectId;
  next();
}, inventoryRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BuildSphere API',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => res.send('BuildSphere API is running'));

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((err, req, res, _next) => {
  console.error('UNHANDLED_SERVER_ERROR:', err.message || err);
  res.status(err.status || 500).json({
    message: err.status && err.status < 500 ? err.message : 'Server error. Please try again later.',
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`BuildSphere API running at http://0.0.0.0:${PORT}`);
});
