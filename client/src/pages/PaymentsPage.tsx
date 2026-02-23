import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const Spinner = () => (
  <div className="flex justify-center py-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

export default function PaymentsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [methods, setMethods] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [methodForm, setMethodForm] = useState({ type: 'card', card_number: '', exp_month: '', exp_year: '', cvv: '', name_on_card: '' });
  const [payForm, setPayForm] = useState({ amount: '', description: '', payment_method_id: '' });

  async function searchPatients() {
    if (search.length < 2) return;
    try {
      const res = await api.get<any>(`/patients?search=${encodeURIComponent(search)}&limit=20`);
      setPatients(res.data || []);
    } catch {}
  }

  async function selectPatient(p: any) {
    setSelectedPatient(p); setPatients([]); setSearch('');
    setError(''); setSuccess('');
    loadPatientData(p.id);
  }

  async function loadPatientData(patientId: string) {
    setLoading(true);
    try {
      const [mRes, tRes] = await Promise.all([
        api.get<any>(`/payments/methods?patient_id=${patientId}`),
        api.get<any>(`/payments/transactions?patient_id=${patientId}&limit=50`),
      ]);
      setMethods(mRes.data || []);
      setTransactions(tRes.data || []);
    } catch { setError('Failed to load payment data'); } finally { setLoading(false); }
  }

  async function addMethod(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await api.post('/payments/methods', { patient_id: selectedPatient.id, ...methodForm });
      setSuccess('Payment method added');
      setShowAddMethod(false);
      setMethodForm({ type: 'card', card_number: '', exp_month: '', exp_year: '', cvv: '', name_on_card: '' });
      loadPatientData(selectedPatient.id);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Failed to add method'); }
  }

  async function processPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await api.post('/payments/process', {
        patient_id: selectedPatient.id,
        payment_method_id: payForm.payment_method_id,
        amount_cents: Math.round(Number(payForm.amount) * 100),
        description: payForm.description,
      });
      setSuccess('Payment processed successfully');
      setShowPayment(false);
      setPayForm({ amount: '', description: '', payment_method_id: '' });
      loadPatientData(selectedPatient.id);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Payment failed'); }
  }

  async function refund(txId: string) {
    if (!confirm('Issue a refund for this transaction?')) return;
    setError(''); setSuccess('');
    try {
      await api.post(`/payments/transactions/${txId}/refund`);
      setSuccess('Refund processed');
      loadPatientData(selectedPatient.id);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Refund failed'); }
  }

  const STATUS_BADGE: Record<string, string> = {
    completed: 'badge-green', pending: 'badge-yellow', failed: 'badge-red', refunded: 'badge-gray',
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Payments</h1>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">{success}</div>}

      <div className="card">
        <label className="label">Search Patient</label>
        <div className="flex gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchPatients()} placeholder="Name or MRN..." className="input flex-1" />
          <button onClick={searchPatients} className="btn-primary text-sm">Search</button>
        </div>
        {patients.length > 0 && (
          <div className="mt-2 border rounded max-h-48 overflow-y-auto divide-y">
            {patients.map((p: any) => (
              <button key={p.id} onClick={() => selectPatient(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                {p.last_name}, {p.first_name} {p.mrn ? `(MRN: ${p.mrn})` : ''}
              </button>
            ))}
          </div>
        )}
        {selectedPatient && (
          <div className="mt-2 text-sm">
            Selected: <span className="font-semibold">{selectedPatient.last_name}, {selectedPatient.first_name}</span>
            <button onClick={() => { setSelectedPatient(null); setMethods([]); setTransactions([]); }} className="ml-2 text-xs text-red-600 underline">Clear</button>
          </div>
        )}
      </div>

      {selectedPatient && (
        <>
          {loading ? <Spinner /> : (
            <>
              <div className="card">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold">Payment Methods</h3>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowAddMethod(true); setError(''); setSuccess(''); }} className="btn-secondary text-sm">+ Add Method</button>
                    {methods.length > 0 && <button onClick={() => { setShowPayment(true); setError(''); setSuccess(''); setPayForm(f => ({ ...f, payment_method_id: methods[0]?.id || '' })); }} className="btn-primary text-sm">Process Payment</button>}
                  </div>
                </div>
                {methods.length === 0 ? (
                  <p className="text-sm text-slate-500">No payment methods on file</p>
                ) : (
                  <div className="space-y-2">
                    {methods.map((m: any) => (
                      <div key={m.id} className="flex items-center justify-between border rounded px-3 py-2">
                        <div className="text-sm">
                          <span className="font-mono">{m.card_brand || 'Card'} **** {m.last_four}</span>
                          <span className="text-slate-500 ml-2">Exp {m.exp_month}/{m.exp_year}</span>
                          {m.is_default && <span className="badge-blue ml-2">Default</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showAddMethod && (
                <form onSubmit={addMethod} className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <h3 className="sm:col-span-2 font-semibold">Add Payment Method</h3>
                  <div><label className="label">Name on Card *</label><input value={methodForm.name_on_card} onChange={e => setMethodForm(f => ({ ...f, name_on_card: e.target.value }))} required className="input" /></div>
                  <div><label className="label">Card Number *</label><input value={methodForm.card_number} onChange={e => setMethodForm(f => ({ ...f, card_number: e.target.value }))} required maxLength={19} placeholder="4111111111111111" className="input font-mono" /></div>
                  <div><label className="label">Exp Month *</label><input value={methodForm.exp_month} onChange={e => setMethodForm(f => ({ ...f, exp_month: e.target.value }))} required maxLength={2} placeholder="MM" className="input" /></div>
                  <div><label className="label">Exp Year *</label><input value={methodForm.exp_year} onChange={e => setMethodForm(f => ({ ...f, exp_year: e.target.value }))} required maxLength={4} placeholder="YYYY" className="input" /></div>
                  <div><label className="label">CVV *</label><input value={methodForm.cvv} onChange={e => setMethodForm(f => ({ ...f, cvv: e.target.value }))} required maxLength={4} type="password" className="input" /></div>
                  <div className="sm:col-span-2 flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowAddMethod(false)} className="btn-secondary">Cancel</button>
                    <button type="submit" className="btn-primary">Add Method</button>
                  </div>
                </form>
              )}

              {showPayment && (
                <form onSubmit={processPayment} className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <h3 className="sm:col-span-2 font-semibold">Process Payment</h3>
                  <div>
                    <label className="label">Payment Method *</label>
                    <select value={payForm.payment_method_id} onChange={e => setPayForm(f => ({ ...f, payment_method_id: e.target.value }))} required className="input">
                      {methods.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.card_brand || 'Card'} **** {m.last_four}</option>
                      ))}
                    </select>
                  </div>
                  <div><label className="label">Amount ($) *</label><input type="number" step="0.01" min="0.01" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} required className="input" /></div>
                  <div className="sm:col-span-2"><label className="label">Description</label><input value={payForm.description} onChange={e => setPayForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Copay, Balance due" className="input" /></div>
                  <div className="sm:col-span-2 flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowPayment(false)} className="btn-secondary">Cancel</button>
                    <button type="submit" className="btn-primary">Charge</button>
                  </div>
                </form>
              )}

              <div className="card">
                <h3 className="font-semibold mb-3">Transaction History</h3>
                {transactions.length === 0 ? (
                  <p className="text-sm text-slate-500">No transactions</p>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left px-4 py-2">Date</th>
                          <th className="text-left px-4 py-2">Description</th>
                          <th className="text-right px-4 py-2">Amount</th>
                          <th className="text-left px-4 py-2">Method</th>
                          <th className="text-left px-4 py-2">Status</th>
                          <th className="text-left px-4 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {transactions.map((t: any) => (
                          <tr key={t.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2 whitespace-nowrap text-xs">{new Date(t.created_at).toLocaleString()}</td>
                            <td className="px-4 py-2">{t.description || '-'}</td>
                            <td className="px-4 py-2 text-right font-mono">${((t.amount_cents || 0) / 100).toFixed(2)}</td>
                            <td className="px-4 py-2 text-xs font-mono">**** {t.last_four || '-'}</td>
                            <td className="px-4 py-2"><span className={STATUS_BADGE[t.status] || 'badge-gray'}>{t.status}</span></td>
                            <td className="px-4 py-2">
                              {t.status === 'completed' && (
                                <button onClick={() => refund(t.id)} className="text-xs text-red-600 underline">Refund</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
