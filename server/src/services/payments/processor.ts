/**
 * Payment Processor Interface
 *
 * Pluggable architecture for payment gateways. Each clinic may use a different
 * processor (Stripe, Square, etc.). Implement this interface to add a new one.
 *
 * IMPORTANT: Never handle raw card numbers. All processors must use tokenized
 * payment methods (tokens from the processor's own JS SDK / hosted fields).
 */

export interface PaymentMethodToken {
  /** Processor-issued token (e.g. Stripe PaymentMethod ID, Square card nonce) */
  token: string;
  /** Last 4 digits for display */
  lastFour: string;
  /** Card brand (visa, mastercard, amex, etc.) */
  brand: string;
  /** Expiration month (1-12) */
  expMonth: number;
  /** Expiration year (4-digit) */
  expYear: number;
}

export interface ChargeRequest {
  /** Amount in cents */
  amountCents: number;
  /** Currency code (e.g. 'usd') */
  currency: string;
  /** Tokenized payment method */
  paymentMethod: PaymentMethodToken;
  /** Human-readable description for the statement */
  description: string;
  /** Clinic's processor account/merchant ID */
  merchantId: string;
  /** Idempotency key to prevent double-charges */
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  /** Processor's transaction ID (for reconciliation) */
  transactionId?: string;
  /** Failure reason if !success */
  error?: string;
  /** Raw processor response (for debugging, never log card data) */
  rawResponse?: unknown;
}

export interface RefundRequest {
  /** Original processor transaction ID */
  transactionId: string;
  /** Amount in cents (full refund if omitted) */
  amountCents?: number;
  /** Reason for the refund */
  reason?: string;
  /** Clinic's processor account/merchant ID */
  merchantId: string;
  /** Idempotency key */
  idempotencyKey: string;
}

export interface RefundResult {
  success: boolean;
  /** Processor's refund ID */
  refundId?: string;
  error?: string;
}

/**
 * Every payment processor integration must implement this.
 * Register implementations in the processor registry below.
 */
export interface PaymentProcessor {
  /** Unique identifier: 'stripe', 'square', etc. */
  readonly name: string;

  /**
   * Charge a tokenized payment method.
   * Must be idempotent — same idempotencyKey returns the same result.
   */
  charge(request: ChargeRequest): Promise<ChargeResult>;

  /**
   * Refund a previous charge.
   * Must be idempotent.
   */
  refund(request: RefundRequest): Promise<RefundResult>;

  /**
   * Validate that the processor is configured for this clinic
   * (API keys present, merchant ID valid, etc.)
   */
  isConfigured(merchantId: string): Promise<boolean>;
}

// ── Processor Registry ──────────────────────────────────────────────────────

const processors = new Map<string, PaymentProcessor>();

export function registerProcessor(processor: PaymentProcessor): void {
  processors.set(processor.name, processor);
}

export function getProcessor(name: string): PaymentProcessor | undefined {
  return processors.get(name);
}

export function listProcessors(): string[] {
  return Array.from(processors.keys());
}
