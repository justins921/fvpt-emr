import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Add credential column to distinguish provider types (PT, DPT, PTA, ATC, etc.)
  // This is separate from "role" — role controls permissions, credential describes the professional title.
  await client.query(`
    ALTER TABLE users
    ADD COLUMN credential VARCHAR(20)
    CHECK (credential IN ('PT','DPT','PTA','ATC','OT','SLP','MD','DO','NP','PA','Office'))
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS credential`);
}
