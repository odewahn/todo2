import pg from 'pg';

const { Pool } = pg;

const isCloudSQL = process.env.DB_HOST?.startsWith('/cloudsql');
const options = process.env.DB_SCHEMA
  ? `--search_path=${process.env.DB_SCHEMA}`
  : undefined;

const pool = new Pool(
  isCloudSQL
    ? {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        options,
      }
    : {
        connectionString: process.env.DATABASE_URL,
        ...(options && { options }),
      }
);

pool.on('error', (err) => {
  console.error('Unexpected database error', err);
});

export default pool;
