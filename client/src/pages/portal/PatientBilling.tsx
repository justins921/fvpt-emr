import { useState, useEffect } from 'react';
import { portalApi } from './portalApi';

interface StatementItem {
  date: string;
  description: string | null;
  charges: number;
  payments: number;
  adjustments: number;
  balance: number;
}

interface PaymentRecord {
  id: string;
  amount_cents: number;
  status: string;
  description: string | null;
  created_at: string;
}

interface StatementData {
  statement_date: string;
  total_balance_due: number;
  items: StatementItem[];
  payment_history: PaymentRecord[];
}

function cents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function PatientBilling() {
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await portalApi<StatementData>('/portal/patient/statement');
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Could not load your billing information.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2" role="alert">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const balance = data.total_balance_due;

  return (
    <div className="space-y-4">
      {/* Balance summary */}
      <div className="card text-center py-6">
        <p className="text-xs uppercase tracking-wide text-slate-400 font-medium">Current Balance</p>
        <p className={`text-4xl font-bold mt-1 ${balance > 0 ? 'text-slate-900' : 'text-green-600'}`}>
          {cents(balance)}
        </p>
        {balance > 0 && (
          <p className="text-sm text-slate-500 mt-2">
            To pay your balance, please contact the clinic directly.
          </p>
        )}
        {balance === 0 && (
          <p className="text-sm text-green-600 mt-2">Your account is paid in full.</p>
        )}
      </div>

      {/* Itemized statement */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Statement Detail</h3>
        {data.items.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-sm text-slate-400">No charges or payments on record yet.</p>
          </div>
        ) : (
          <div className="card divide-y divide-slate-100 !p-0 overflow-hidden">
            {data.items.map((item, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {item.description || 'Visit'}
                    </p>
                    <p className="text-xs text-slate-400">{fmtDate(item.date)}</p>
                  </div>
                  <div className="text-right text-sm whitespace-nowrap">
                    {item.charges > 0 && <p className="text-slate-900">{cents(item.charges)}</p>}
                    {item.payments > 0 && <p className="text-green-600">−{cents(item.payments)}</p>}
                    {item.adjustments > 0 && <p className="text-slate-400">−{cents(item.adjustments)} adj.</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment history */}
      {data.payment_history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">Payment History</h3>
          <div className="card divide-y divide-slate-100 !p-0 overflow-hidden">
            {data.payment_history.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {p.description || 'Payment'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <p className="text-sm font-semibold text-green-600 whitespace-nowrap">{cents(p.amount_cents)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
