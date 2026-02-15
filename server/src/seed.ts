import { pool } from './db';
import { hashPassword } from './services/auth';

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding demo data...');

    // Create demo clinic
    const clinicResult = await client.query(`
      INSERT INTO clinics (name, npi, tax_id, address_line1, city, state, zip, phone)
      VALUES ('Sobojinski Solutions Demo Clinic', '1234567890', '12-3456789', '100 Demo Street', 'Faketown', 'CA', '90210', '555-0100')
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    let clinicId: string;
    if (clinicResult.rows.length > 0) {
      clinicId = clinicResult.rows[0].id;
    } else {
      const existing = await client.query("SELECT id FROM clinics WHERE npi = '1234567890'");
      clinicId = existing.rows[0].id;
    }
    console.log('Clinic ID:', clinicId);

    // Create demo users — realistic PT clinic staff
    const adminHash = await hashPassword('password123!');
    const users = [
      // Owner / admin (also a PT)
      { username: 'admin', firstName: 'Sarah', lastName: 'Mitchell', role: 'owner', credential: 'DPT', npi: '1234567890' },
      // Physical therapists (5 total including owner)
      { username: 'mchen', firstName: 'Mike', lastName: 'Chen', role: 'therapist', credential: 'DPT', npi: '0987654321' },
      { username: 'jruiz', firstName: 'Jessica', lastName: 'Ruiz', role: 'therapist', credential: 'PT', npi: '1122334455' },
      { username: 'dokafor', firstName: 'David', lastName: 'Okafor', role: 'therapist', credential: 'DPT', npi: '2233445566' },
      { username: 'alee', firstName: 'Amanda', lastName: 'Lee', role: 'therapist', credential: 'PT', npi: '3344556677' },
      // Athletic trainer
      { username: 'rbrooks', firstName: 'Ryan', lastName: 'Brooks', role: 'therapist', credential: 'ATC', npi: '4455667788' },
      // PTAs (not scheduling providers — they work under a PT)
      { username: 'cvega', firstName: 'Carlos', lastName: 'Vega', role: 'therapist', credential: 'PTA', npi: '5566778899' },
      { username: 'nward', firstName: 'Natalie', lastName: 'Ward', role: 'therapist', credential: 'PTA', npi: '6677889900' },
      // Office staff
      { username: 'lnguyen', firstName: 'Lisa', lastName: 'Nguyen', role: 'front_desk', credential: 'Office', npi: null },
      { username: 'tparker', firstName: 'Tom', lastName: 'Parker', role: 'biller', credential: 'Office', npi: null },
      { username: 'msantos', firstName: 'Maria', lastName: 'Santos', role: 'front_desk', credential: 'Office', npi: null },
      { username: 'jobserver', firstName: 'Jane', lastName: 'Observer', role: 'read_only', credential: null, npi: null },
      // Developer
      { username: 'jsob', firstName: 'Justin', lastName: 'Sobojinski', role: 'dev', credential: null, npi: null },
    ];

    const userIds: Record<string, string> = {};
    const therapistUserIds: string[] = []; // scheduling providers only
    for (const u of users) {
      const result = await client.query(`
        INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (clinic_id, username) DO UPDATE SET first_name = $4, credential = $7
        RETURNING id
      `, [clinicId, u.username, adminHash, u.firstName, u.lastName, u.role, u.credential, u.npi]);
      userIds[u.username] = result.rows[0].id;
      // Track scheduling providers (PT, DPT, ATC — not PTA or Office)
      if (['PT', 'DPT', 'ATC'].includes(u.credential || '')) {
        therapistUserIds.push(result.rows[0].id);
      }
      console.log(`User: ${u.username} (${u.role}, ${u.credential || 'none'})`);
    }

    // Create FAKE patients
    const fakePatients = [
      { firstName: 'James', lastName: 'Testington', dob: '1985-03-15', gender: 'male', phone: '555-0201', dx: 'M54.5', precautions: null },
      { firstName: 'Maria', lastName: 'Demoson', dob: '1992-07-22', gender: 'female', phone: '555-0202', dx: 'M79.3', precautions: 'Fall risk' },
      { firstName: 'Robert', lastName: 'Fictitious', dob: '1978-11-08', gender: 'male', phone: '555-0203', dx: 'S83.511A', precautions: null },
      { firstName: 'Emily', lastName: 'Sampleworth', dob: '1965-01-30', gender: 'female', phone: '555-0204', dx: 'M17.11', precautions: 'Diabetes - monitor closely' },
      { firstName: 'David', lastName: 'Placeholder', dob: '2000-05-12', gender: 'male', phone: '555-0205', dx: 'M25.511', precautions: null },
      { firstName: 'Sarah', lastName: 'Mockdata', dob: '1988-09-25', gender: 'female', phone: '555-0206', dx: 'G89.29', precautions: null },
      { firstName: 'Michael', lastName: 'Fauxpatient', dob: '1972-12-03', gender: 'male', phone: '555-0207', dx: 'M47.812', precautions: 'Cardiac precautions' },
      { firstName: 'Jennifer', lastName: 'Notreal', dob: '1995-06-18', gender: 'female', phone: '555-0208', dx: 'S42.001A', precautions: null },
    ];

    const patientIds: string[] = [];
    for (let i = 0; i < fakePatients.length; i++) {
      const p = fakePatients[i];
      const mrn = `PT-DEMO-${String(i + 1).padStart(4, '0')}`;
      const result = await client.query(`
        INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions,
          address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (clinic_id, mrn) DO UPDATE SET first_name = $3
        RETURNING id
      `, [clinicId, mrn, p.firstName, p.lastName, p.dob, p.gender, p.phone, p.dx, p.precautions,
          '123 Fake St', 'Faketown', 'CA', '90210', `${p.firstName.toLowerCase()}@fake.test`,
          'Emergency Contact', '555-0999']);
      patientIds.push(result.rows[0].id);
      console.log(`Patient: ${p.firstName} ${p.lastName} (${mrn})`);
    }

    // Create insurance for first few patients
    for (let i = 0; i < 4; i++) {
      await client.query(`
        INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, member_id, subscriber_name, subscriber_dob, subscriber_relationship, coverage_start, authorized_visits, is_primary)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
        ON CONFLICT DO NOTHING
      `, [clinicId, patientIds[i], 'Demo Insurance Co', 'DEMO001', `MEM${100 + i}`,
          fakePatients[i].firstName + ' ' + fakePatients[i].lastName, fakePatients[i].dob, 'self', '2024-01-01', 30]);
    }
    console.log('Insurance records created');

    // Create appointments for today spread across providers
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fallbackTherapist = therapistUserIds[0] || Object.values(userIds)[0];

    const appointmentSlots = [
      { hour: 8, type: 'evaluation', providerIdx: 0, patientIdx: 0, status: 'completed' },
      { hour: 8, type: 'follow_up', providerIdx: 1, patientIdx: 1, status: 'completed' },
      { hour: 8, type: 'follow_up', providerIdx: 2, patientIdx: 2, status: 'in_progress' },
      { hour: 9, type: 'follow_up', providerIdx: 0, patientIdx: 3, status: 'checked_in' },
      { hour: 9, type: 're_evaluation', providerIdx: 1, patientIdx: 4, status: 'scheduled' },
      { hour: 9, type: 'follow_up', providerIdx: 3, patientIdx: 5, status: 'scheduled' },
      { hour: 10, type: 'follow_up', providerIdx: 0, patientIdx: 6, status: 'scheduled' },
      { hour: 10, type: 'evaluation', providerIdx: 2, patientIdx: 7, status: 'scheduled' },
      { hour: 10, type: 'follow_up', providerIdx: 4, patientIdx: 0, status: 'scheduled' },
      { hour: 11, type: 're_evaluation', providerIdx: 1, patientIdx: 1, status: 'scheduled' },
      { hour: 13, type: 'follow_up', providerIdx: 0, patientIdx: 2, status: 'scheduled' },
      { hour: 13, type: 'follow_up', providerIdx: 5, patientIdx: 3, status: 'scheduled' },
      { hour: 14, type: 'follow_up', providerIdx: 2, patientIdx: 4, status: 'scheduled' },
      { hour: 14, type: 'discharge', providerIdx: 3, patientIdx: 5, status: 'scheduled' },
    ];

    for (const slot of appointmentSlots) {
      const therapistId = therapistUserIds[slot.providerIdx] || fallbackTherapist;
      const patientId = patientIds[slot.patientIdx % patientIds.length];
      const start = new Date(today);
      start.setHours(slot.hour, 0, 0, 0);
      const end = new Date(start);
      end.setMinutes(45);

      await client.query(`
        INSERT INTO appointments (clinic_id, patient_id, therapist_id, start_time, end_time, appointment_type, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [clinicId, patientId, therapistId, start.toISOString(), end.toISOString(), slot.type, slot.status]);
    }
    console.log('Appointments created');

    // Create sample clinical notes for first 3 patients
    const soapNotes = [
      { s: 'Patient reports improvement in lower back pain. Pain decreased from 7/10 to 4/10. Able to sit for 45 minutes without discomfort.', o: 'Lumbar ROM: Flexion 60 degrees (improved from 45). Extension 15 degrees. SLR negative bilaterally. Tenderness decreased over L4-L5 paraspinals.', a: 'Patient progressing well with lumbar stabilization program. Meeting short-term goals.', p: 'Continue current HEP. Progress core stabilization. Reassess in 2 visits.' },
      { s: 'Patient complains of persistent right knee swelling and stiffness. Reports difficulty with stairs. Pain 5/10 with activity.', o: 'Right knee ROM: Flexion 110 degrees, Extension -5 degrees. Mild effusion present. Quad strength 4/5. Single leg balance 15 seconds.', a: 'Slow progress with knee rehabilitation. Effusion limiting ROM gains.', p: 'Ice and compression post-treatment. Modify exercises to reduce swelling. Consider physician follow-up if no improvement.' },
      { s: 'Patient reports she can now reach overhead without sharp pain. Sleep improving. Only mild discomfort with heavy lifting.', o: 'Right shoulder flexion 160 degrees (WNL). Abduction 150 degrees. ER/IR 45/60 degrees. Rotator cuff strength 4+/5. Impingement tests negative.', a: 'Significant improvement in shoulder function. Approaching discharge criteria.', p: 'Progress to functional strengthening. Begin discharge planning. 2-3 more visits anticipated.' },
    ];

    const noteAuthorId = therapistUserIds[0] || fallbackTherapist;
    for (let i = 0; i < 3; i++) {
      const note = soapNotes[i];
      await client.query(`
        INSERT INTO clinical_notes (clinic_id, patient_id, author_id, note_type, subjective, objective, assessment, plan, cpt_codes, icd10_codes, treatment_time_minutes)
        VALUES ($1, $2, $3, 'daily_soap', $4, $5, $6, $7, $8, $9, $10)
      `, [clinicId, patientIds[i], noteAuthorId, note.s, note.o, note.a, note.p,
          ['97110', '97140', '97530'], [fakePatients[i].dx], 45]);
    }
    console.log('Clinical notes created');

    // Create sample claims
    for (let i = 0; i < 3; i++) {
      const claimNumber = `CLM-DEMO-${String(i + 1).padStart(4, '0')}`;
      const lineItems = [
        { line_number: 1, cpt_code: '97110', modifiers: [], diagnosis_pointers: [1], units: 2, charge_cents: 7500, paid_cents: 0, adjustment_cents: 0, denial_reason: null },
        { line_number: 2, cpt_code: '97140', modifiers: [], diagnosis_pointers: [1], units: 1, charge_cents: 6500, paid_cents: 0, adjustment_cents: 0, denial_reason: null },
        { line_number: 3, cpt_code: '97530', modifiers: [], diagnosis_pointers: [1], units: 1, charge_cents: 6000, paid_cents: 0, adjustment_cents: 0, denial_reason: null },
      ];
      const totalCharge = lineItems.reduce((s, l) => s + l.charge_cents * l.units, 0);

      await client.query(`
        INSERT INTO claims (clinic_id, patient_id, claim_number, service_date, billing_provider_npi, rendering_provider_npi, diagnosis_codes, line_items, total_charge_cents, status)
        VALUES ($1, $2, $3, $4, '1234567890', '0987654321', $5, $6, $7, 'draft')
        ON CONFLICT DO NOTHING
      `, [clinicId, patientIds[i], claimNumber, new Date().toISOString().substring(0, 10),
          [fakePatients[i].dx], JSON.stringify(lineItems), totalCharge]);

      // Post charges to ledger
      for (const item of lineItems) {
        await client.query(`
          INSERT INTO ledger_entries (clinic_id, patient_id, entry_type, amount_cents, description, cpt_code, service_date, posted_by)
          VALUES ($1, $2, 'charge', $3, $4, $5, $6, $7)
        `, [clinicId, patientIds[i], item.charge_cents * item.units, `Charge: ${item.cpt_code}`, item.cpt_code,
            new Date().toISOString().substring(0, 10), noteAuthorId]);
      }
    }
    console.log('Claims and ledger entries created');

    console.log('\n=== Seed Complete ===');
    console.log('Demo Login: admin / password123!');
    console.log('All users share the same password: password123!');
  } catch (err) {
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
