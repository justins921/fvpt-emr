// ── Roles & Permissions ──
export enum Role {
  OWNER = 'owner',
  ADMIN = 'admin',
  DEV = 'dev',
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

  // Import
  DATA_IMPORT = 'data:import',

  // Support
  SUPPORT_CREATE = 'support:create',
  SUPPORT_MANAGE = 'support:manage',

  // Messaging
  MESSAGING_VIEW = 'messaging:view',
  MESSAGING_SEND = 'messaging:send',
  MESSAGING_MANAGE = 'messaging:manage',

  // Admin
  BACKUP_MANAGE = 'backup:manage',
  SETTINGS_MANAGE = 'settings:manage',

  // ── New Permissions ──

  // HEP / Exercises
  HEP_VIEW = 'hep:view',
  HEP_CREATE = 'hep:create',
  HEP_EDIT = 'hep:edit',
  HEP_DELETE = 'hep:delete',

  // Plan of Care
  POC_VIEW = 'poc:view',
  POC_CREATE = 'poc:create',
  POC_EDIT = 'poc:edit',

  // Outcome Measures
  OUTCOME_VIEW = 'outcome:view',
  OUTCOME_CREATE = 'outcome:create',

  // Intake Forms
  INTAKE_VIEW = 'intake:view',
  INTAKE_CREATE = 'intake:create',
  INTAKE_MANAGE = 'intake:manage',

  // Eligibility
  ELIGIBILITY_CHECK = 'eligibility:check',
  ELIGIBILITY_VIEW = 'eligibility:view',

  // Fax
  FAX_SEND = 'fax:send',
  FAX_VIEW = 'fax:view',

  // Telehealth
  TELEHEALTH_CREATE = 'telehealth:create',
  TELEHEALTH_VIEW = 'telehealth:view',

  // Waitlist
  WAITLIST_VIEW = 'waitlist:view',
  WAITLIST_MANAGE = 'waitlist:manage',

  // Tasks
  TASK_VIEW = 'task:view',
  TASK_CREATE = 'task:create',
  TASK_MANAGE = 'task:manage',

  // Recall Campaigns
  RECALL_VIEW = 'recall:view',
  RECALL_MANAGE = 'recall:manage',

  // Workers Comp
  WORKERS_COMP_VIEW = 'workers_comp:view',
  WORKERS_COMP_MANAGE = 'workers_comp:manage',

  // Portal
  PORTAL_MANAGE = 'portal:manage',

  // Payments
  PAYMENT_VIEW = 'payment:view',
  PAYMENT_PROCESS = 'payment:process',

  // Reporting
  REPORT_VIEW = 'report:view',

  // Locations
  LOCATION_VIEW = 'location:view',
  LOCATION_MANAGE = 'location:manage',

  // MIPS
  MIPS_VIEW = 'mips:view',
  MIPS_MANAGE = 'mips:manage',

  // FHIR
  FHIR_MANAGE = 'fhir:manage',

  // Referring Providers
  REFERRING_PROVIDER_VIEW = 'referring_provider:view',
  REFERRING_PROVIDER_MANAGE = 'referring_provider:manage',

  // Text Expanders
  TEXT_EXPANDER_VIEW = 'text_expander:view',
  TEXT_EXPANDER_MANAGE = 'text_expander:manage',

  // Authorizations
  AUTHORIZATION_VIEW = 'authorization:view',
  AUTHORIZATION_MANAGE = 'authorization:manage',
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.OWNER]: Object.values(Permission),
  [Role.ADMIN]: Object.values(Permission),
  // DEV role only has permissions in development — in production it's read-only
  [Role.DEV]: process.env.NODE_ENV === 'production'
    ? [Permission.CLINIC_VIEW, Permission.PATIENT_VIEW, Permission.SCHEDULE_VIEW, Permission.NOTE_VIEW, Permission.SUPPORT_CREATE]
    : Object.values(Permission),
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
    Permission.SUPPORT_CREATE,
    Permission.MESSAGING_VIEW,
    Permission.MESSAGING_SEND,
    Permission.HEP_VIEW,
    Permission.HEP_CREATE,
    Permission.HEP_EDIT,
    Permission.POC_VIEW,
    Permission.POC_CREATE,
    Permission.POC_EDIT,
    Permission.OUTCOME_VIEW,
    Permission.OUTCOME_CREATE,
    Permission.INTAKE_VIEW,
    Permission.ELIGIBILITY_VIEW,
    Permission.FAX_SEND,
    Permission.FAX_VIEW,
    Permission.TELEHEALTH_CREATE,
    Permission.TELEHEALTH_VIEW,
    Permission.WAITLIST_VIEW,
    Permission.WAITLIST_MANAGE,
    Permission.TASK_VIEW,
    Permission.TASK_CREATE,
    Permission.WORKERS_COMP_VIEW,
    Permission.REPORT_VIEW,
    Permission.LOCATION_VIEW,
    Permission.REFERRING_PROVIDER_VIEW,
    Permission.TEXT_EXPANDER_VIEW,
    Permission.TEXT_EXPANDER_MANAGE,
    Permission.AUTHORIZATION_VIEW,
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
    Permission.SUPPORT_CREATE,
    Permission.MESSAGING_VIEW,
    Permission.MESSAGING_SEND,
    Permission.INTAKE_VIEW,
    Permission.INTAKE_CREATE,
    Permission.ELIGIBILITY_CHECK,
    Permission.ELIGIBILITY_VIEW,
    Permission.FAX_SEND,
    Permission.FAX_VIEW,
    Permission.WAITLIST_VIEW,
    Permission.WAITLIST_MANAGE,
    Permission.TASK_VIEW,
    Permission.TASK_CREATE,
    Permission.PAYMENT_VIEW,
    Permission.PAYMENT_PROCESS,
    Permission.LOCATION_VIEW,
    Permission.REFERRING_PROVIDER_VIEW,
    Permission.AUTHORIZATION_VIEW,
    Permission.AUTHORIZATION_MANAGE,
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
    Permission.SUPPORT_CREATE,
    Permission.MESSAGING_VIEW,
    Permission.ELIGIBILITY_CHECK,
    Permission.ELIGIBILITY_VIEW,
    Permission.PAYMENT_VIEW,
    Permission.PAYMENT_PROCESS,
    Permission.REPORT_VIEW,
    Permission.AUTHORIZATION_VIEW,
    Permission.AUTHORIZATION_MANAGE,
    Permission.WORKERS_COMP_VIEW,
    Permission.WORKERS_COMP_MANAGE,
    Permission.MIPS_VIEW,
    Permission.MIPS_MANAGE,
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
    Permission.SUPPORT_CREATE,
    Permission.MESSAGING_VIEW,
    Permission.HEP_VIEW,
    Permission.POC_VIEW,
    Permission.OUTCOME_VIEW,
    Permission.INTAKE_VIEW,
    Permission.ELIGIBILITY_VIEW,
    Permission.FAX_VIEW,
    Permission.TELEHEALTH_VIEW,
    Permission.WAITLIST_VIEW,
    Permission.TASK_VIEW,
    Permission.RECALL_VIEW,
    Permission.WORKERS_COMP_VIEW,
    Permission.PAYMENT_VIEW,
    Permission.REPORT_VIEW,
    Permission.LOCATION_VIEW,
    Permission.REFERRING_PROVIDER_VIEW,
    Permission.AUTHORIZATION_VIEW,
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
  username: string;
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
  referring_provider_id: string | null;
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
  location_id: string | null;
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

  // Import
  DATA_IMPORT = 'data.import',

  // Support
  SUPPORT_CREATE = 'support.create',
  SUPPORT_UPDATE = 'support.update',

  // Messaging
  SMS_SEND = 'sms.send',
  SMS_BULK_SEND = 'sms.bulk_send',
  SMS_TEMPLATE_CREATE = 'sms.template_create',
  SMS_TEMPLATE_UPDATE = 'sms.template_update',
  SMS_TEMPLATE_DELETE = 'sms.template_delete',

  // Admin
  USER_CREATE = 'user.create',
  USER_EDIT = 'user.edit',
  USER_DEACTIVATE = 'user.deactivate',
  SETTINGS_CHANGE = 'settings.change',
  BACKUP_CREATE = 'backup.create',
  BACKUP_RESTORE = 'backup.restore',

  // ── New Audit Actions ──

  // HEP
  HEP_EXERCISE_CREATE = 'hep.exercise_create',
  HEP_EXERCISE_EDIT = 'hep.exercise_edit',
  HEP_PROGRAM_CREATE = 'hep.program_create',
  HEP_PROGRAM_EDIT = 'hep.program_edit',
  HEP_PROGRAM_ASSIGN = 'hep.program_assign',

  // Plan of Care
  POC_CREATE = 'poc.create',
  POC_EDIT = 'poc.edit',
  POC_SIGN = 'poc.sign',

  // Outcome Measures
  OUTCOME_CREATE = 'outcome.create',

  // Intake Forms
  INTAKE_TEMPLATE_CREATE = 'intake.template_create',
  INTAKE_SUBMIT = 'intake.submit',
  INTAKE_REVIEW = 'intake.review',

  // Eligibility
  ELIGIBILITY_CHECK = 'eligibility.check',

  // Fax
  FAX_SEND = 'fax.send',
  FAX_RECEIVE = 'fax.receive',

  // Telehealth
  TELEHEALTH_CREATE = 'telehealth.create',
  TELEHEALTH_START = 'telehealth.start',
  TELEHEALTH_END = 'telehealth.end',

  // Waitlist
  WAITLIST_ADD = 'waitlist.add',
  WAITLIST_UPDATE = 'waitlist.update',

  // Tasks
  TASK_CREATE = 'task.create',
  TASK_UPDATE = 'task.update',
  TASK_COMPLETE = 'task.complete',

  // Recall
  RECALL_CREATE = 'recall.create',
  RECALL_SEND = 'recall.send',

  // Workers Comp
  WC_CASE_CREATE = 'wc.case_create',
  WC_CASE_EDIT = 'wc.case_edit',

  // Portal
  PORTAL_USER_CREATE = 'portal.user_create',
  PORTAL_MESSAGE_SEND = 'portal.message_send',

  // Payments
  PAYMENT_PROCESS = 'payment.process',
  PAYMENT_REFUND = 'payment.refund',

  // Locations
  LOCATION_CREATE = 'location.create',
  LOCATION_EDIT = 'location.edit',

  // MIPS
  MIPS_RECORD = 'mips.record',
  MIPS_SUBMIT = 'mips.submit',

  // FHIR
  FHIR_SYNC = 'fhir.sync',

  // Referring Providers
  REFERRING_PROVIDER_CREATE = 'referring_provider.create',
  REFERRING_PROVIDER_EDIT = 'referring_provider.edit',

  // Authorization
  AUTHORIZATION_CREATE = 'authorization.create',
  AUTHORIZATION_EDIT = 'authorization.edit',
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

// ── Fax Provider ──
export interface FaxProvider {
  sendFax(to: string, documentUrl: string, coverPage?: string): Promise<{ messageId: string; status: string }>;
  getStatus(messageId: string): Promise<{ status: string; pages: number; error?: string }>;
}

// ── Payment Processor ──
export interface PaymentProcessor {
  createCustomer(patientId: string, email: string): Promise<{ customerId: string }>;
  tokenizeCard(customerId: string, cardDetails: Record<string, string>): Promise<{ token: string; last4: string; brand: string; expMonth: number; expYear: number }>;
  charge(token: string, amountCents: number, description: string): Promise<{ transactionId: string; status: string }>;
  refund(transactionId: string, amountCents?: number): Promise<{ refundId: string; status: string }>;
}

// ── 8-Minute Rule Types ──
export interface TimedCPTEntry {
  cptCode: string;
  minutes: number;
}

export interface EightMinuteRuleResult {
  entries: Array<{
    cptCode: string;
    minutes: number;
    units: number;
  }>;
  totalMinutes: number;
  totalUnits: number;
}

// ── Outcome Measure Definitions ──
export enum OutcomeMeasureType {
  LEFS = 'LEFS',
  DASH = 'DASH',
  NDI = 'NDI',
  OSWESTRY = 'Oswestry',
  SPADI = 'SPADI',
  BERG_BALANCE = 'Berg Balance',
  NPRS = 'NPRS',
  PSFS = 'PSFS',
  QUICK_DASH = 'QuickDASH',
  PHQ9 = 'PHQ-9',
  GAD7 = 'GAD-7',
  CUSTOM = 'Custom',
}

// ── Body Chart Region Types ──
export interface BodyChartMarker {
  id: string;
  x: number;
  y: number;
  region: string;
  painType: 'sharp' | 'dull' | 'burning' | 'aching' | 'tingling' | 'numbness';
  intensity: number;
  notes: string;
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
