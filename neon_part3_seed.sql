-- Part 3: Seed Data (clinics, users, patients, insurance, templates)

-- SEED DATA
-- ════════════════════════════════════════

INSERT INTO clinics (name, npi, tax_id, address_line1, city, state, zip, phone)
VALUES ('Sobojinski Solutions Demo Clinic', '1234567890', '12-3456789', '100 Demo Street', 'Faketown', 'CA', '90210', '555-0100')
ON CONFLICT DO NOTHING;

INSERT INTO clinics (name, npi, tax_id, address_line1, city, state, zip, phone, fax)
VALUES ('Fox Valley Physical Therapy', '1639574820', '83-2941567', '1750 N Randall Rd', 'Elgin', 'IL', '60123', '847-608-5100', '847-608-5101')
ON CONFLICT DO NOTHING;

-- Demo clinic users (password: password123!)
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'admin', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Sarah', 'Mitchell', 'owner', 'DPT', '1234567890'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'mchen', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Mike', 'Chen', 'therapist', 'DPT', '0987654321'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'jruiz', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Jessica', 'Ruiz', 'therapist', 'PT', '1122334455'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'dokafor', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'David', 'Okafor', 'therapist', 'DPT', '2233445566'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'alee', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Amanda', 'Lee', 'therapist', 'PT', '3344556677'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'rbrooks', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Ryan', 'Brooks', 'therapist', 'ATC', '4455667788'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'cvega', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Carlos', 'Vega', 'therapist', 'PTA', '5566778899'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'nward', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Natalie', 'Ward', 'therapist', 'PTA', '6677889900'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'lnguyen', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Lisa', 'Nguyen', 'front_desk', 'Office', NULL
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'tparker', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Tom', 'Parker', 'biller', 'Office', NULL
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'msantos', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Maria', 'Santos', 'front_desk', 'Office', NULL
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'jobserver', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Jane', 'Observer', 'read_only', NULL, NULL
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'jsob', '$2a$12$.pFw/LKkoD9wyxWTo7Div.KXiVGG3seZAa.hAQIOJmETDu0HFHqRq', 'Justin', 'Sobojinski', 'dev', NULL, NULL
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, username) DO NOTHING;

-- FVPT user (password: FoxValley2024!)
INSERT INTO users (clinic_id, username, password_hash, first_name, last_name, role, credential, npi)
SELECT id, 'paula', '$2a$12$ZtIPmtSNgnqN/eN0ZI2hFutxZKFod9YtGJDbyldTRukC9ufb7Ly8W', 'Paula', 'Sobojinski', 'owner', 'DPT', '1639574820'
FROM clinics WHERE npi = '1639574820'
ON CONFLICT (clinic_id, username) DO NOTHING;

-- Demo patients
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0001', 'James', 'Testington', '1985-03-15', 'male', '555-0201', 'M54.5', NULL, '123 Fake St', 'Faketown', 'CA', '90210', 'james@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0002', 'Maria', 'Demoson', '1992-07-22', 'female', '555-0202', 'M79.3', 'Fall risk', '123 Fake St', 'Faketown', 'CA', '90210', 'maria@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0003', 'Robert', 'Fictitious', '1978-11-08', 'male', '555-0203', 'S83.511A', NULL, '123 Fake St', 'Faketown', 'CA', '90210', 'robert@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0004', 'Emily', 'Sampleworth', '1965-01-30', 'female', '555-0204', 'M17.11', 'Diabetes - monitor closely', '123 Fake St', 'Faketown', 'CA', '90210', 'emily@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0005', 'David', 'Placeholder', '2000-05-12', 'male', '555-0205', 'M25.511', NULL, '123 Fake St', 'Faketown', 'CA', '90210', 'david@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0006', 'Sarah', 'Mockdata', '1988-09-25', 'female', '555-0206', 'G89.29', NULL, '123 Fake St', 'Faketown', 'CA', '90210', 'sarah@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0007', 'Michael', 'Fauxpatient', '1972-12-03', 'male', '555-0207', 'M47.812', 'Cardiac precautions', '123 Fake St', 'Faketown', 'CA', '90210', 'michael@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;
INSERT INTO patients (clinic_id, mrn, first_name, last_name, date_of_birth, gender, phone, primary_diagnosis_icd10, precautions, address_line1, city, state, zip, email, emergency_contact_name, emergency_contact_phone)
SELECT id, 'PT-DEMO-0008', 'Jennifer', 'Notreal', '1995-06-18', 'female', '555-0208', 'S42.001A', NULL, '123 Fake St', 'Faketown', 'CA', '90210', 'jennifer@fake.test', 'Emergency Contact', '555-0999'
FROM clinics WHERE npi = '1234567890'
ON CONFLICT (clinic_id, mrn) DO NOTHING;

-- Demo insurance
INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, member_id, subscriber_name, subscriber_dob, subscriber_relationship, coverage_start, authorized_visits, is_primary)
SELECT c.id, p.id, 'Demo Insurance Co', 'DEMO001', 'MEM100', 'James Testington', '1985-03-15', 'self', '2024-01-01', 30, true
FROM clinics c JOIN patients p ON p.clinic_id = c.id AND p.mrn = 'PT-DEMO-0001'
WHERE c.npi = '1234567890'
ON CONFLICT DO NOTHING;
INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, member_id, subscriber_name, subscriber_dob, subscriber_relationship, coverage_start, authorized_visits, is_primary)
SELECT c.id, p.id, 'Demo Insurance Co', 'DEMO001', 'MEM101', 'Maria Demoson', '1992-07-22', 'self', '2024-01-01', 30, true
FROM clinics c JOIN patients p ON p.clinic_id = c.id AND p.mrn = 'PT-DEMO-0002'
WHERE c.npi = '1234567890'
ON CONFLICT DO NOTHING;
INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, member_id, subscriber_name, subscriber_dob, subscriber_relationship, coverage_start, authorized_visits, is_primary)
SELECT c.id, p.id, 'Demo Insurance Co', 'DEMO001', 'MEM102', 'Robert Fictitious', '1978-11-08', 'self', '2024-01-01', 30, true
FROM clinics c JOIN patients p ON p.clinic_id = c.id AND p.mrn = 'PT-DEMO-0003'
WHERE c.npi = '1234567890'
ON CONFLICT DO NOTHING;
INSERT INTO insurance (clinic_id, patient_id, payer_name, payer_id, member_id, subscriber_name, subscriber_dob, subscriber_relationship, coverage_start, authorized_visits, is_primary)
SELECT c.id, p.id, 'Demo Insurance Co', 'DEMO001', 'MEM103', 'Emily Sampleworth', '1965-01-30', 'self', '2024-01-01', 30, true
FROM clinics c JOIN patients p ON p.clinic_id = c.id AND p.mrn = 'PT-DEMO-0004'
WHERE c.npi = '1234567890'
ON CONFLICT DO NOTHING;

-- SMS templates
INSERT INTO sms_templates (clinic_id, name, body, template_type, created_by)
SELECT c.id, 'Appointment Reminder', 'Hi {{first_name}}, this is a reminder about your appointment on {{appointment_date}} at {{appointment_time}}. Please call {{clinic_phone}} if you need to reschedule. - {{clinic_name}}', 'reminder', u.id
FROM clinics c JOIN users u ON u.clinic_id = c.id AND u.username = 'admin'
WHERE c.npi = '1234567890'
ON CONFLICT DO NOTHING;
INSERT INTO sms_templates (clinic_id, name, body, template_type, created_by)
SELECT c.id, 'Happy Birthday', 'Happy Birthday, {{first_name}}! Wishing you a wonderful day from all of us at {{clinic_name}}.', 'birthday', u.id
FROM clinics c JOIN users u ON u.clinic_id = c.id AND u.username = 'admin'
WHERE c.npi = '1234567890'
ON CONFLICT DO NOTHING;
INSERT INTO sms_templates (clinic_id, name, body, template_type, created_by)
SELECT c.id, 'Follow-up Check-in', 'Hi {{first_name}}, just checking in to see how you''re doing after your recent visit. If you have any questions, please call us at {{clinic_phone}}. - {{clinic_name}}', 'follow_up', u.id
FROM clinics c JOIN users u ON u.clinic_id = c.id AND u.username = 'admin'
WHERE c.npi = '1234567890'
ON CONFLICT DO NOTHING;



-- ════════════════════════════════════════
-- ALL MIGRATIONS + SEED DATA COMPLETE
-- ════════════════════════════════════════
-- Demo Login:  admin / password123!
-- FVPT Login:  paula / FoxValley2024!
-- All demo users share password: password123!
