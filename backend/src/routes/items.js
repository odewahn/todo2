import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM items ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(
    'INSERT INTO items (name) VALUES ($1) RETURNING *',
    [name.trim()]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
