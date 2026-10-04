import { PoolClient } from 'pg';

/**
 * Migration 010 — Note templates.
 *
 * Reusable SOAP note templates per clinic. Therapists can apply a template
 * when starting a note instead of typing the same structure every visit.
 * Seeds one starter template per note type for every clinic that has an
 * active user.
 */

export async function up(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE note_templates (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      note_type VARCHAR(50) NOT NULL CHECK (note_type IN ('evaluation', 'daily_soap', 'progress', 'discharge')),
      subjective_template TEXT,
      objective_template TEXT,
      assessment_template TEXT,
      plan_template TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX idx_note_templates_clinic ON note_templates(clinic_id);`);
  await client.query(`CREATE INDEX idx_note_templates_clinic_type ON note_templates(clinic_id, note_type);`);

  await client.query(`
    CREATE TRIGGER update_note_templates_updated_at
    BEFORE UPDATE ON note_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  // Seed starter templates for every clinic with at least one active user.
  // Dollar-quoting avoids escaping issues in template bodies.
  await client.query(`
    INSERT INTO note_templates (clinic_id, name, note_type, subjective_template, objective_template, assessment_template, plan_template, created_by)
    SELECT c.id, v.name, v.note_type, v.subjective, v.objective, v.assessment, v.plan, u.id
    FROM clinics c
    JOIN users u ON u.id = (
      SELECT u2.id FROM users u2
      WHERE u2.clinic_id = c.id AND u2.is_active = true
      ORDER BY u2.created_at ASC LIMIT 1
    )
    CROSS JOIN (
      VALUES
        ('Daily SOAP Note', 'daily_soap',
         $$Pain [ ]/10 in [location], described as [sharp/dull/aching]. Agg: [activity]. Eases with [rest/ice/heat]. HEP compliance: [ ].$$,
         $$Gait: [ ]. AROM: [ ]. PROM: [ ]. MMT: [ ]. Palpation: [ ]. Special tests: [ ].$$,
         $$[Dx]. Status: [improving/stable/regressing]. Goal progress: [ ].$$,
         $$Continue POC. Tx: [ ]. HEP: [ ]. Next: [ ].$$),
        ('Initial Evaluation', 'evaluation',
         $$CC: [ ]. Onset: [ ]. MOI: [ ]. Pain [ ]/10, [quality]. PMH: [ ]. Prior PT: [ ]. Goals: [ ].$$,
         $$Posture: [ ]. Gait: [ ]. ROM: [ ]. MMT: [ ]. Palpation: [ ]. Special tests: [ ]. Neuro: [ ].$$,
         $$Clinical impression: [ ]. Rehab potential: [good/fair/poor].$$,
         $$POC: [ ]x/wk x [ ] wks. Interventions: [ ]. HEP issued. Re-eval in [ ] wks.$$),
        ('Progress Note', 'progress',
         $$Pain [ ]/10. Function: [ ]. HEP compliance: [ ].$$,
         $$Re-measures: [ ]. ROM: [ ]. Strength: [ ].$$,
         $$Goals: [on track/behind]. [Continue/modify] POC.$$, 
         $$[ ]. Next re-eval: [ ].$$),
        ('Discharge Summary', 'discharge',
         $$Pain [ ]/10. Reports [meeting] goals.$$, 
         $$Final: ROM [ ], strength [ ].$$,
         $$Goals [met]. Discharge appropriate.$$, 
         $$D/C from PT. Independent HEP given. Precautions reviewed. RTC PRN.$$)
    ) AS v(name, note_type, subjective, objective, assessment, plan);
  `);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS note_templates CASCADE;`);
}
