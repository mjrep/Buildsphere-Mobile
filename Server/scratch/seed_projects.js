const pool = require('../db');

async function seed() {
  const projects = [
    {
      project_name: 'Main Glass Installation',
      address: 'Glassworks Site A',
      color: '#FFD6F3',
      status: 'ongoing',
      project_in_charge_id: 2,
      end_date: new Date(Date.now() + 128 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      project_name: 'Secondary Facade',
      address: 'Glassworks Site B',
      color: '#FFD6F3',
      status: 'ongoing',
      project_in_charge_id: 2,
      end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
        project_name: 'Tower C Glazing',
        address: 'Glassworks Site C',
        color: '#FFD6F3',
        status: 'ongoing',
        project_in_charge_id: 2,
        end_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  for (const p of projects) {
    try {
      await pool.query(
        'INSERT INTO projects (project_name, address, color, status, project_in_charge_id, end_date, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
        [p.project_name, p.address, p.color, p.status, p.project_in_charge_id, p.end_date]
      );
      console.log('Seeded:', p.project_name);
    } catch (err) {
      console.error('Error seeding:', err);
    }
  }
  pool.end();
}

seed();
