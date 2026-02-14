import { ClearinghouseAdapter, Claim, Patient, Insurance } from '../types';

/**
 * SandboxClearinghouseAdapter simulates clearinghouse responses for demo/testing.
 * Replace with OfficeAllyAdapter / AvailityAdapter / OptumAdapter for production.
 */
export class SandboxClearinghouseAdapter implements ClearinghouseAdapter {
  async submit837P(claim: Claim, ediContent: string): Promise<{ trackingId: string; accepted: boolean }> {
    // Simulate network delay
    await delay(500);

    const trackingId = `TRK-${Date.now().toString(36).toUpperCase()}`;

    // Simulate 90% acceptance rate
    const accepted = Math.random() > 0.1;

    return { trackingId, accepted };
  }

  async fetchAcknowledgements(trackingIds: string[]): Promise<Array<{ trackingId: string; status: string; errors: string[] }>> {
    await delay(300);

    return trackingIds.map(id => ({
      trackingId: id,
      status: Math.random() > 0.15 ? 'accepted' : 'rejected',
      errors: Math.random() > 0.85 ? ['Missing subscriber ID'] : [],
    }));
  }

  async fetchERAs(fromDate: string, toDate: string): Promise<Array<{ content: string; checkNumber: string }>> {
    await delay(400);

    // Generate a sample ERA
    const checkNum = `CHK${Date.now().toString(36).toUpperCase()}`;
    const sampleERA = [
      `ISA*00*          *00*          *ZZ*PAYERID        *ZZ*CLINICNPI      *240101*1200*^*00501*000000001*0*P*:~`,
      `GS*HP*PAYERID*CLINICNPI*20240101*1200*1*X*005010X221A1~`,
      `ST*835*0001~`,
      `BPR*I*150.00*C*ACH~`,
      `TRN*1*${checkNum}~`,
      `DTM*405*20240115~`,
      `N1*PR*DEMO INSURANCE CO~`,
      `CLP*CLM-DEMO1*1*200.00*150.00~`,
      `NM1*QC*1*DOE*JANE~`,
      `SVC*HC:97110*75.00*60.00~`,
      `CAS*CO*45*15.00~`,
      `SVC*HC:97140*65.00*50.00~`,
      `CAS*CO*45*15.00~`,
      `SVC*HC:97530*60.00*40.00~`,
      `CAS*CO*45*10.00*PR*42*10.00~`,
      `SE*15*0001~`,
      `GE*1*1~`,
      `IEA*1*000000001~`,
    ].join('\n');

    return [{ content: sampleERA, checkNumber: checkNum }];
  }

  async eligibility270(patient: Patient, insurance: Insurance): Promise<{ eligible: boolean; details: Record<string, unknown> }> {
    await delay(600);

    return {
      eligible: true,
      details: {
        planName: 'Demo PPO Plan',
        copay: 3000, // $30.00 in cents
        deductible: 50000,
        deductibleMet: 35000,
        coinsurance: 20,
        outOfPocketMax: 500000,
        outOfPocketMet: 120000,
        ptVisitsAllowed: 30,
        ptVisitsUsed: 5,
        authRequired: false,
      },
    };
  }

  async claimStatus276(claimNumber: string): Promise<{ status: string; details: Record<string, unknown> }> {
    await delay(400);

    const statuses = ['received', 'in_process', 'adjudicated', 'finalized'];
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    return {
      status,
      details: {
        claimNumber,
        statusDate: new Date().toISOString().substring(0, 10),
        estimatedPayDate: status === 'finalized'
          ? new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10)
          : null,
      },
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
