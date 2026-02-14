// ── Roles & Permissions ──
export enum Role {
  OWNER = 'owner',
  ADMIN = 'admin',
  THERAPIST = 'therapist',
  FRONT_DESK = 'front_desk',
  BILLER = 'biller',
  READ_ONLY = 'read_only',
}

export enum Permission {
  // Clinic management
  CLINIC_MANAGE = 'clinic:manage',
  CLINIC_VIEW = 'clinic:view',

  // User management
  USER_CREATE = 'user:create',
  USER_EDIT = 'user:edit',
  USER_VIEW = 'user:view',
  USER_DEACTIVATE = 'user:deactivate',

  // Patient
  PATIENT_CREATE = 'patient:create',
  PATIENT_EDIT = 'patient:edit',
  PATIENT_VIEW = 'patient:view',
  PATIENT_DELETE = 'patient:delete',
  PATIENT_EXPORT = 'patient:export',

  // Scheduling
  SCHEDULE_CREATE = 'schedule:create',
  SCHEDULE_EDIT = 'schedule:edit',
  SCHEDULE_VIEW = 'schedule:view',
  SCHEDULE_DELETE = 'schedule:delete',

  // Notes / Documentation
  NOTE_CREATE = 'note:create',
  NOTE_EDIT = 'note:edit',
  NOTE_VIEW = 'note:view',
  NOTE_SIGN = 'note:sign',
  NOTE_AMEND = 'note:amend',

  // Attachments
  ATTACHMENT_UPLOAD = 'attachment:upload',
  ATTACHMENT_VIEW = 'attachment:view',
  ATTACHMENT_DELETE = 'attachment:delete',

  // Billing
  BILLING_VIEW = 'billing:view',
  BILLING_CREATE = 'billing:create',
  BILLING_EDIT = 'billing:edit',
  BILLING_EXPORT = 'billing:export',
  CLAIM_SUBMIT = 'claim:submit',
  CLAIM_VIEW = 'claim:view',
  ERA_IMPORT = 'era:import',
  LEDGER_VIEW = 'ledger:view',
  LEDGER_EDIT = 'ledger:edit',

  // Audit
  AUDIT_VIEW = 'audit:view',

  // Admin
  BACKUP_MANAGE = 'backup:manage',
  SETTINGS_MANAGE = 'settings:manage',
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.OWNER]: Object.values(Permission),
  [Role.ADMIN]: Object.values(Permission),
  [Role.THERAPIST]: [
    Permission.CLINIC_VIEW,
    Permission.PATIENT_CREATE,
    Permission.PATIENT_EDIT,
    Permission.PATIENT_VIEW,
    Permission.SCHEDULE_CREATE,
    Permission.SCHEDULE_EDIT,
    Permission.SCHEDULE_VIEW,
    Permission.NOTE_CREATE,
    Permission.NOTE_EDIT,
    Permission.NOTE_VIEW,
    Permission.NOTE_SIGN,
    Permission.NOTE_AMEND,
    Permission.ATTACHMENT_UPLOAD,
    Permission.ATTACHMENT_VIEW,
    Permission.BILLING_VIEW,
    Permission.USER_VIEW,
  ],
  [Role.FRONT_DESK]: [
    Permission.CLINIC_VIEW,
    Permission.PATIENT_CREATE,
    Permission.PATIENT_EDIT,
    Permission.PATIENT_VIEW,
    Permission.SCHEDULE_CREATE,
    Permission.SCHEDULE_EDIT,
    Permission.SCHEDULE_VIEW,
    Permission.SCHEDULE_DELETE,
    Permission.ATTACHMENT_UPLOAD,
    Permission.ATTACHMENT_VIEW,
    Permission.BILLING_VIEW,
    Permission.USER_VIEW,
  ],
  [Role.BILLER]: [
    Permission.CLINIC_VIEW,
    Permission.PATIENT_VIEW,
    Permission.SCHEDULE_VIEW,
    Permission.NOTE_VIEW,
    Permission.ATTACHMENT_VIEW,
    Permission.BILLING_VIEW,
    Permission.BILLING_CREATE,
    Permission.BILLING_EDIT,
    Permission.BILLING_EXPORT,
    Permission.CLAIM_SUBMIT,
    Permission.CLAIM_VIEW,
    Permission.ERA_IMPORT,
    Permission.LEDGER_VIEW,
    Permission.LEDGER_EDIT,
    Permission.USER_VIEW,
  ],
  [Role.READ_ONLY]: [
    Permission.CLINIC_VIEW,
    Permission.PATIENT_VIEW,
    Permission.SCHEDULE_VIEW,
    Permission.NOTE_VIEW,
    Permission.ATTACHMENT_VIEW,
    Permission.BILLING_VIEW,
    Permission.CLAIM_VIEW,
    Permission.LEDGER_VIEW,
    Permission.USER_VIEW,
  ],
};

// ── Auth ──
export interface JWTPayload {
  userId: string;
  clinicId: string;
  role: Role;
  sessionId: string;
}

export interface AuthenticatedRequest {
  userId: string;
  clinicId: string;
  role: Role;
  sessionId: string;
}

// ── Database Row Types ──
export interface Clinic {
  id: string;
  name: string;
  npi: string;
  tax_id: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip: string;
  phone: string;
  fax: string | null;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export type Credential = 'PT' | 'DPT' | 'PTA' | 'ATC' | 'OT' | 'SLP' | 'MD' | 'DO' | 'NP' | 'PA' | 'Office';

/** Credentials that represent scheduling providers (shown as columns in the day view). */
export const SCHEDULING_CREDENTIALS: Credential[] = ['PT', 'DPT', 'ATC'];

export interface User {
  id: string;
  clinic_id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: Role;
  credential: Credential | null;
  npi: string | null;
  license_number: string | null;
  is_active: boolean;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Patient {
  id: string;
  clinic_id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ssn_last4: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  primary_insurance_id: string | null;
  secondary_insurance_id: string | null;
  guarantor_name: string | null;
  guarantor_phone: string | null;
  guarantor_relationship: string | null;
  referral_source: string | null;
  referring_provider: string | null;
  referring_provider_npi: string | null;
  primary_diagnosis_icd10: string | null;
  secondary_diagnoses_icd10: string[];
  precautions: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Insurance {
  id: string;
  clinic_id: string;
  patient_id: string;
  payer_name: string;
  payer_id: string;
  plan_name: string | null;
  member_id: string;
  group_number: string | null;
  subscriber_name: string;
  subscriber_dob: string;
  subscriber_relationship: string;
  coverage_start: string;
  coverage_end: string | null;
  authorization_number: string | null;
  authorized_visits: number | null;
  used_visits: number;
  is_primary: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  therapist_id: string;
  start_time: Date;
  end_time: Date;
  appointment_type: AppointmentType;
  status: AppointmentStatus;
  notes: string | null;
  recurring_rule: string | null;
  created_at: Date;
  updated_at: Date;
}

export enum AppointmentType {
  EVALUATION = 'evaluation',
  FOLLOW_UP = 'follow_up',
  RE_EVALUATION = 're_evaluation',
  DISCHARGE = 'discharge',
}

export enum AppointmentStatus {
  SCHEDULED = 'scheduled',
  CHECKED_IN = 'checked_in',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export enum NoteType {
  EVALUATION = 'evaluation',
  DAILY_SOAP = 'daily_soap',
  PROGRESS = 'progress',
  DISCHARGE = 'discharge',
}

export enum NoteStatus {
  DRAFT = 'draft',
  FINAL = 'final',
  AMENDED = 'amended',
}

export interface ClinicalNote {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id: string | null;
  author_id: string;
  note_type: NoteType;
  status: NoteStatus;
  version: number;
  parent_note_id: string | null;
  amendment_reason: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  eval_data: Record<string, unknown> | null;
  cpt_codes: string[];
  icd10_codes: string[];
  treatment_time_minutes: number | null;
  signed_by: string | null;
  signed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Attachment {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  note_id: string | null;
  claim_id: string | null;
  filename: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_by: string;
  scan_status: 'pending' | 'clean' | 'infected' | 'skipped';
  created_at: Date;
}

// ── Billing ──
export enum LedgerEntryType {
  CHARGE = 'charge',
  PAYMENT = 'payment',
  ADJUSTMENT = 'adjustment',
  REFUND = 'refund',
  WRITE_OFF = 'write_off',
}

export interface LedgerEntry {
  id: string;
  clinic_id: string;
  patient_id: string;
  claim_id: string | null;
  entry_type: LedgerEntryType;
  amount_cents: number;
  description: string;
  cpt_code: string | null;
  service_date: string | null;
  payer_name: string | null;
  check_number: string | null;
  posted_by: string;
  posted_at: Date;
  created_at: Date;
}

export enum ClaimStatus {
  DRAFT = 'draft',
  SCRUBBED = 'scrubbed',
  SCRUB_FAILED = 'scrub_failed',
  SUBMITTED = 'submitted',
  ACKNOWLEDGED = 'acknowledged',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  DENIED = 'denied',
  PAID = 'paid',
  PARTIALLY_PAID = 'partially_paid',
  APPEALED = 'appealed',
}

export interface Claim {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id: string | null;
  note_id: string | null;
  insurance_id: string | null;
  status: ClaimStatus;
  claim_number: string | null;
  payer_claim_number: string | null;
  service_date: string;
  billing_provider_npi: string;
  rendering_provider_npi: string;
  diagnosis_codes: string[];
  line_items: ClaimLineItem[];
  total_charge_cents: number;
  total_paid_cents: number;
  total_adjustment_cents: number;
  patient_responsibility_cents: number;
  scrub_errors: string[];
  submitted_at: Date | null;
  era_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ClaimLineItem {
  line_number: number;
  cpt_code: string;
  modifiers: string[];
  diagnosis_pointers: number[];
  units: number;
  charge_cents: number;
  paid_cents: number;
  adjustment_cents: number;
  denial_reason: string | null;
}

export interface ERAFile {
  id: string;
  clinic_id: string;
  filename: string;
  raw_content: string;
  check_number: string | null;
  check_date: string | null;
  payer_name: string | null;
  total_paid_cents: number;
  claims_count: number;
  posted: boolean;
  posted_by: string | null;
  posted_at: Date | null;
  imported_at: Date;
}

// ── Audit ──
export enum AuditAction {
  // Auth
  LOGIN = 'auth.login',
  LOGOUT = 'auth.logout',
  LOGIN_FAILED = 'auth.login_failed',
  SESSION_EXPIRED = 'auth.session_expired',

  // Patient
  PATIENT_CREATE = 'patient.create',
  PATIENT_VIEW = 'patient.view',
  PATIENT_EDIT = 'patient.edit',
  PATIENT_EXPORT = 'patient.export',
  PATIENT_DELETE = 'patient.delete',

  // Chart
  CHART_OPEN = 'chart.open',

  // Notes
  NOTE_CREATE = 'note.create',
  NOTE_VIEW = 'note.view',
  NOTE_EDIT = 'note.edit',
  NOTE_SIGN = 'note.sign',
  NOTE_AMEND = 'note.amend',

  // Attachments
  ATTACHMENT_UPLOAD = 'attachment.upload',
  ATTACHMENT_VIEW = 'attachment.view',
  ATTACHMENT_DELETE = 'attachment.delete',

  // Scheduling
  APPOINTMENT_CREATE = 'appointment.create',
  APPOINTMENT_EDIT = 'appointment.edit',
  APPOINTMENT_CANCEL = 'appointment.cancel',

  // Billing
  LEDGER_CREATE = 'ledger.create',
  LEDGER_EDIT = 'ledger.edit',
  CLAIM_CREATE = 'claim.create',
  CLAIM_SUBMIT = 'claim.submit',
  CLAIM_EDIT = 'claim.edit',
  ERA_IMPORT = 'era.import',
  ERA_POST = 'era.post',

  // Admin
  USER_CREATE = 'user.create',
  USER_EDIT = 'user.edit',
  USER_DEACTIVATE = 'user.deactivate',
  SETTINGS_CHANGE = 'settings.change',
  BACKUP_CREATE = 'backup.create',
  BACKUP_RESTORE = 'backup.restore',
}

export interface AuditEvent {
  id: string;
  clinic_id: string;
  user_id: string | null;
  action: AuditAction;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string;
  user_agent: string | null;
  created_at: Date;
}

// ── Clearinghouse Adapter ──
export interface ClearinghouseAdapter {
  submit837P(claim: Claim, ediContent: string): Promise<{ trackingId: string; accepted: boolean }>;
  fetchAcknowledgements(trackingIds: string[]): Promise<Array<{ trackingId: string; status: string; errors: string[] }>>;
  fetchERAs(fromDate: string, toDate: string): Promise<Array<{ content: string; checkNumber: string }>>;
  eligibility270(patient: Patient, insurance: Insurance): Promise<{ eligible: boolean; details: Record<string, unknown> }>;
  claimStatus276(claimNumber: string): Promise<{ status: string; details: Record<string, unknown> }>;
}

// ── Transcription Provider ──
export interface TranscriptionProvider {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<{ text: string; confidence: number }>;
  isAvailable(): Promise<boolean>;
}

// ── API Response ──
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}
