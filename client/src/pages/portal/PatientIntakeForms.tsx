import { useState, useEffect } from 'react';
import { portalApi } from './portalApi';

interface AssignedForm {
  submission_id: string;
  status: string;
  expires_at: string | null;
  submitted_at: string | null;
  template_id: string;
  template_name: string;
  template_description: string | null;
}

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'phone' | 'email' | 'signature';
  required: boolean;
  options?: string[];
}

interface FormSection {
  title: string;
  fields: FormField[];
}

interface FormDetail {
  submission_id: string;
  status: string;
  template_name: string;
  template_description: string | null;
  sections: FormSection[];
  responses: Record<string, any>;
}

export default function PatientIntakeForms() {
  const [forms, setForms] = useState<AssignedForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await portalApi<AssignedForm[]>('/portal/patient/intake-forms');
      setForms(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Could not load your forms.');
    } finally {
      setLoading(false);
    }
  }

  if (selectedId) {
    return <FormFill submissionId={selectedId} onBack={() => { setSelectedId(null); load(); }} />;
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

  if (forms.length === 0) {
    return (
      <div className="card text-center py-10">
        <p className="text-slate-600 font-medium">No forms to fill out</p>
        <p className="text-sm text-slate-400 mt-1">
          When your clinic sends you intake forms, they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {forms.map((f) => (
        <button
          key={f.submission_id}
          onClick={() => setSelectedId(f.submission_id)}
          className="card w-full text-left hover:border-primary-300 transition-colors"
        >
          <p className="font-semibold text-slate-900">{f.template_name}</p>
          {f.template_description && (
            <p className="text-sm text-slate-500 mt-0.5">{f.template_description}</p>
          )}
          <p className="text-xs text-slate-400 mt-1.5">
            {f.status === 'in_progress' ? 'Continue filling out' : 'Tap to fill out'}
            {f.expires_at && ` · Expires ${new Date(f.expires_at).toLocaleDateString()}`}
          </p>
        </button>
      ))}
    </div>
  );
}

function FormFill({ submissionId, onBack }: { submissionId: string; onBack: () => void }) {
  const [form, setForm] = useState<FormDetail | null>(null);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    load();
  }, [submissionId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await portalApi<FormDetail>(`/portal/patient/intake-forms/${submissionId}`);
      setForm(data);
      setResponses(data.responses || {});
    } catch (err: any) {
      setError(err.message || 'Could not load this form.');
    } finally {
      setLoading(false);
    }
  }

  function setValue(name: string, value: any) {
    setResponses((r) => ({ ...r, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await portalApi(`/portal/patient/intake-forms/${submissionId}`, {
        method: 'PUT',
        body: { responses },
      });
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Could not submit this form.');
    } finally {
      setSubmitting(false);
    }
  }

  function renderField(field: FormField) {
    const value = responses[field.name] ?? '';
    const common = 'input';
    switch (field.type) {
      case 'textarea':
        return (
          <textarea className={common} rows={3} value={value} onChange={(e) => setValue(field.name, e.target.value)} required={field.required} />
        );
      case 'select':
        return (
          <select className={common} value={value} onChange={(e) => setValue(field.name, e.target.value)} required={field.required}>
            <option value="">Select…</option>
            {(field.options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 min-h-[44px]">
            <input type="checkbox" className="h-5 w-5" checked={!!value} onChange={(e) => setValue(field.name, e.target.checked)} />
            <span className="text-sm text-slate-600">Yes</span>
          </label>
        );
      case 'date':
        return <input type="date" className={common} value={value} onChange={(e) => setValue(field.name, e.target.value)} required={field.required} />;
      case 'phone':
        return <input type="tel" className={common} value={value} onChange={(e) => setValue(field.name, e.target.value)} required={field.required} autoComplete="tel" />;
      case 'email':
        return <input type="email" className={common} value={value} onChange={(e) => setValue(field.name, e.target.value)} required={field.required} autoComplete="email" />;
      case 'signature':
        return (
          <input
            type="text"
            className={common}
            value={value}
            onChange={(e) => setValue(field.name, e.target.value)}
            required={field.required}
            placeholder="Type your full name to sign"
          />
        );
      default:
        return <input type="text" className={common} value={value} onChange={(e) => setValue(field.name, e.target.value)} required={field.required} />;
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="card text-center py-10">
        <p className="text-slate-900 font-semibold text-lg">Form submitted</p>
        <p className="text-sm text-slate-500 mt-1">Your clinic has received your responses.</p>
        <button onClick={onBack} className="btn-primary mt-4 min-h-[44px]">Back to Forms</button>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mt-3" role="alert">{error}</div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div>
      <BackButton onBack={onBack} />
      <h2 className="text-lg font-bold text-slate-900 mt-2">{form.template_name}</h2>
      {form.template_description && (
        <p className="text-sm text-slate-500 mt-0.5">{form.template_description}</p>
      )}
      <form onSubmit={handleSubmit} className="mt-4 space-y-5">
        {form.sections.map((section, si) => (
          <div key={si} className="card">
            <h3 className="font-semibold text-slate-800 mb-3">{section.title}</h3>
            <div className="space-y-4">
              {section.fields.map((field) => (
                <div key={field.name}>
                  <label className="label">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          </div>
        ))}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2" role="alert">
            {error}
          </div>
        )}
        <button type="submit" disabled={submitting} className="btn-primary w-full min-h-[48px]">
          {submitting ? 'Submitting…' : 'Submit Form'}
        </button>
      </form>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="text-sm text-primary-600 underline min-h-[44px]">
      ← Back
    </button>
  );
}
