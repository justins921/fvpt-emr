/**
 * Payment Service — processor-agnostic payment operations.
 *
 * Flow:
 * 1. Clinic configures their processor (Stripe, Square, etc.) in settings
 * 2. Patient's card is tokenized by the processor's JS SDK (never touches our server)
 * 3. We store only the token + last4/brand/exp for display
 * 4. Charges go through the registered processor implementation
 *
 * To add a new processor:
 * 1. Create `server/src/services/payments/<name>.ts` implementing PaymentProcessor
 * 2. Call `registerProcessor(new <Name>Processor())` at startup
 * 3. Add the processor name to clinic settings UI
 */

import { query } from '../../db';
import {
  PaymentProcessor,
  ChargeRequest,
  ChargeResult,
  RefundRequest,
  RefundResult,
  getProcessor,
} from './processor';

export { PaymentProcessor, ChargeRequest, ChargeResult, RefundRequest, RefundResult };

/**
 * Get the configured processor for a clinic.
 * Returns null if no processor is configured (payments disabled).
 */
export async function getClinicProcessor(
  clinicId: string
): Promise<{ processor: PaymentProcessor; merchantId: string } | null> {
  const result = await query(
    `SELECT payment_processor, payment_merchant_id
     FROM clinic_settings WHERE clinic_id = $1`,
    [clinicId]
  );

  if (result.rows.length === 0) return null;

  const { payment_processor, payment_merchant_id } = result.rows[0];
  if (!payment_processor || !payment_merchant_id) return null;

  const processor = getProcessor(payment_processor);
  if (!processor) return null;

  return { processor, merchantId: payment_merchant_id };
}

/**
 * Process a charge through the clinic's configured processor.
 * Records the transaction in our ledger regardless of processor.
 */
export async function processCharge(
  clinicId: string,
  patientId: string,
  paymentMethodId: string,
  amountCents: number,
  description: string,
  processedBy: string
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  const config = await getClinicProcessor(clinicId);
  if (!config) {
    return { success: false, error: 'No payment processor configured for this clinic' };
  }

  // Verify payment method belongs to this patient/clinic
  const methodResult = await query(
    `SELECT id, processor_token, last_four, brand
     FROM payment_methods
     WHERE id = $1 AND clinic_id = $2 AND patient_id = $3 AND is_active = true`,
    [paymentMethodId, clinicId, patientId]
  );

  if (methodResult.rows.length === 0) {
    return { success: false, error: 'Payment method not found or inactive' };
  }

  const method = methodResult.rows[0];
  const idempotencyKey = `charge-${clinicId}-${paymentMethodId}-${Date.now()}`;

  const chargeRequest: ChargeRequest = {
    amountCents,
    currency: 'usd',
    paymentMethod: {
      token: method.processor_token,
      lastFour: method.last_four,
      brand: method.brand,
      expMonth: 0, // Not needed for charge, stored for display
      expYear: 0,
    },
    description,
    merchantId: config.merchantId,
    idempotencyKey,
  };

  const result: ChargeResult = await config.processor.charge(chargeRequest);

  // Record transaction in our database
  const txnResult = await query(
    `INSERT INTO payment_transactions
       (clinic_id, patient_id, payment_method_id, amount_cents, description,
        processor, processor_transaction_id, status, processed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      clinicId,
      patientId,
      paymentMethodId,
      amountCents,
      description,
      config.processor.name,
      result.transactionId || null,
      result.success ? 'completed' : 'failed',
      processedBy,
    ]
  );

  if (result.success) {
    // Post to ledger
    await query(
      `INSERT INTO ledger_entries
         (clinic_id, patient_id, entry_type, amount_cents, description, posted_by)
       VALUES ($1,$2,'payment',$3,$4,$5)`,
      [clinicId, patientId, amountCents, `Payment: ${description}`, processedBy]
    );
  }

  return {
    success: result.success,
    transactionId: txnResult.rows[0].id,
    error: result.error,
  };
}

/**
 * Process a refund through the clinic's configured processor.
 */
export async function processRefund(
  clinicId: string,
  transactionId: string,
  amountCents: number | undefined,
  reason: string | undefined,
  processedBy: string
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  const config = await getClinicProcessor(clinicId);
  if (!config) {
    return { success: false, error: 'No payment processor configured for this clinic' };
  }

  // Get original transaction
  const txnResult = await query(
    `SELECT id, processor_transaction_id, processor, patient_id, amount_cents
     FROM payment_transactions
     WHERE id = $1 AND clinic_id = $2 AND status = 'completed'`,
    [transactionId, clinicId]
  );

  if (txnResult.rows.length === 0) {
    return { success: false, error: 'Transaction not found or not refundable' };
  }

  const txn = txnResult.rows[0];

  // Must use the same processor that processed the original charge
  const originalProcessor = getProcessor(txn.processor);
  if (!originalProcessor) {
    return { success: false, error: `Original processor '${txn.processor}' not available` };
  }

  const refundRequest: RefundRequest = {
    transactionId: txn.processor_transaction_id,
    amountCents,
    reason,
    merchantId: config.merchantId,
    idempotencyKey: `refund-${transactionId}-${Date.now()}`,
  };

  const result: RefundResult = await originalProcessor.refund(refundRequest);

  if (result.success) {
    const refundAmount = amountCents || txn.amount_cents;
    await query(
      `INSERT INTO payment_transactions
         (clinic_id, patient_id, amount_cents, description,
          processor, processor_transaction_id, status, processed_by)
       VALUES ($1,$2,$3,$4,$5,$6,'refunded',$7)`,
      [
        clinicId,
        txn.patient_id,
        -refundAmount,
        `Refund: ${reason || 'No reason given'}`,
        txn.processor,
        result.refundId,
        processedBy,
      ]
    );

    await query(
      `INSERT INTO ledger_entries
         (clinic_id, patient_id, entry_type, amount_cents, description, posted_by)
       VALUES ($1,$2,'refund',$3,$4,$5)`,
      [clinicId, txn.patient_id, -refundAmount, `Refund: ${reason || ''}`, processedBy]
    );
  }

  return {
    success: result.success,
    refundId: result.refundId,
    error: result.error,
  };
}
