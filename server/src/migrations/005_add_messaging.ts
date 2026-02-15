import { PoolClient } from 'pg';

export async function up(client: PoolClient): Promise<void> {
  // SMS messages table - stores all inbound and outbound messages
  await client.query(`
    CREATE TABLE sms_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      body TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'received')),
      message_type VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (message_type IN ('manual', 'reminder', 'birthday', 'follow_up', 'custom')),
      sent_by UUID REFERENCES users(id),
      to_number VARCHAR(20),
      from_number VARCHAR(20),
      external_id VARCHAR(100),
      error_message TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_sms_clinic_patient ON sms_messages(clinic_id, patient_id);`);
  await client.query(`CREATE INDEX idx_sms_clinic_created ON sms_messages(clinic_id, created_at DESC);`);
  await client.query(`CREATE INDEX idx_sms_external_id ON sms_messages(external_id);`);
  await client.query(`CREATE INDEX idx_sms_status ON sms_messages(status);`);

  // Message templates
  await client.query(`
    CREATE TABLE sms_templates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      body TEXT NOT NULL,
      template_type VARCHAR(20) NOT NULL CHECK (template_type IN ('reminder', 'birthday', 'follow_up', 'custom')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_sms_templates_clinic ON sms_templates(clinic_id);`);

  // Add updated_at trigger
  await client.query(`
    CREATE TRIGGER update_sms_templates_updated_at
    BEFORE UPDATE ON sms_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS sms_messages CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS sms_templates CASCADE;`);
}
