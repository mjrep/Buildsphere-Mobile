-- Mobile Inventory Logs + Account/Profile polish
-- Safe migration: only adds missing columns, reuses existing tables.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS middle_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS suffix VARCHAR(50),
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS gender VARCHAR(40),
  ADD COLUMN IF NOT EXISTS birthdate DATE,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS department VARCHAR(120),
  ADD COLUMN IF NOT EXISTS position VARCHAR(120),
  ADD COLUMN IF NOT EXISTS account_status VARCHAR(30) DEFAULT 'active';

ALTER TABLE project_inventory_items
  ADD COLUMN IF NOT EXISTS unit VARCHAR(30) DEFAULT 'pcs';
