import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // Add 'dev' to the user role CHECK constraint
  await client.query(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  `);
  await client.query(`
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('owner','admin','dev','therapist','front_desk','biller','read_only'));
  `);

  // Create support_requests table
  await client.query(`
    CREATE TABLE support_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      submitted_by UUID NOT NULL REFERENCES users(id),
      request_type VARCHAR(20) NOT NULL CHECK (request_type IN ('support','bug','feature')),
      subject VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
      priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
      dev_notes TEXT,
      resolved_by UUID REFERENCES users(id),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_support_clinic ON support_requests(clinic_id);`);
  await client.query(`CREATE INDEX idx_support_submitted_by ON support_requests(submitted_by);`);
  await client.query(`CREATE INDEX idx_support_status ON support_requests(status);`);

  // Add updated_at trigger
  await client.query(`
    CREATE TRIGGER update_support_requests_updated_at
    BEFORE UPDATE ON support_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS support_requests CASCADE;`);

  // Revert role constraint
  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
  await client.query(`
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('owner','admin','therapist','front_desk','biller','read_only'));
  `);
}
