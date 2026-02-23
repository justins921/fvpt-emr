import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';
import { useAuth } from '../hooks/useAuth';

interface FormTemplate { id: string; name: string; description: string; is_active: boolean; section_count: number; field_count: number; created_at: string; updated_by_name: string; }
interface TemplateSection { id?: string; title: string; order: number; fields: TemplateField[]; }
interface TemplateField { id?: string; label: string; field_type: string; required: boolean; options: string; order: number; }
interface Submission { id: string; template_id: string; template_name: string; patient_id: string; patient_first_name: string; patient_last_name: string; status: string; sent_at: string; completed_at: string | null; reviewed_at: string | null; reviewed_by_name: string | null; }
interface SubmissionDetail { id: string; template_name: string; patient_first_name: string; patient_last_name: string; status: string; responses: { section: string; label: string; value: string; field_type: string }[]; }

type Tab = 'templates' | 'submissions';

const FIELD_TYPES = ['text', 'textarea', 'select', 'checkbox', 'date', 'phone', 'email', 'number', 'signature'];

export default function IntakeFormsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('submissions');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Intake Forms</h1>
          <p className="text-sm text-slate-500 mt-1">Digital intake form templates and patient submissions</p>
        </div>
      </div>
      <div className="flex gap-1 border-b">
        {([['submissions', 'Submissions'], ['templates', 'Templates']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'submissions' ? <SubmissionList /> : <TemplateManager />}
    </div>
  );
}

function TemplateManager() {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<FormTemplate | null>(null);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');

  useEffect(() => { loadTemplates(); }, []);

  async function loadTemplates() {
    setLoading(true);
    try {
      const res = await api.get<any>('/intake-forms/templates');
      setTemplates(res.data || []);
    } catch {} finally { setLoading(false); }
  }

  function openNew() {
    setEditing(null);
    setTemplateName('');
    setTemplateDesc('');
    setSections([{ title: 'General Information', order: 1, fields: [
      { label: '', field_type: 'text', required: false, options: '', order: 1 },
    ]}]);
    setShowEditor(true);
  }

  async function openEdit(tmpl: FormTemplate) {
    try {
      const res = await api.get<any>(`/intake-forms/templates/${tmpl.id}`);
      setEditing(tmpl);
      setTemplateName(tmpl.name);
      setTemplateDesc(tmpl.description);
      setSections(res.data?.sections || [{ title: 'General Information', order: 1, fields: [] }]);
      setShowEditor(true);
    } catch {}
  }

  function addSection() {
    setSections(prev => [...prev, { title: '', order: prev.length + 1, fields: [
      { label: '', field_type: 'text', required: false, options: '', order: 1 },
    ]}]);
  }

  const removeSection = (idx: number) => setSections(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  const updateSection = (idx: number, title: string) => setSections(prev => prev.map((s, i) => i === idx ? { ...s, title } : s));
  const addField = (si: number) => setSections(prev => prev.map((s, i) => i === si ? { ...s, fields: [...s.fields, { label: '', field_type: 'text', required: false, options: '', order: s.fields.length + 1 }] } : s));
  const removeField = (si: number, fi: number) => setSections(prev => prev.map((s, i) => i === si ? { ...s, fields: s.fields.filter((_, j) => j !== fi).map((f, j) => ({ ...f, order: j + 1 })) } : s));
  const updateField = (si: number, fi: number, u: Partial<TemplateField>) => setSections(prev => prev.map((s, i) => i === si ? { ...s, fields: s.fields.map((f, j) => j === fi ? { ...f, ...u } : f) } : s));

  async function handleSave() {
    if (!templateName.trim()) { alert('Template name is required'); return; }
    const validSections = sections.filter(s => s.title.trim());
    if (validSections.length === 0) { alert('At least one section is required'); return; }
    try {
      const payload = {
        name: templateName,
        description: templateDesc,
        sections: validSections.map(s => ({
          title: s.title,
          order: s.order,
          fields: s.fields.filter(f => f.label.trim()).map(f => ({
            label: f.label,
            fieldType: f.field_type,
            required: f.required,
            options: f.options || null,
            order: f.order,
          })),
        })),
      };
      if (editing) {
        await api.put(`/intake-forms/templates/${editing.id}`, payload);
      } else {
        await api.post('/intake-forms/templates', payload);
      }
      setShowEditor(false);
      loadTemplates();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to save template');
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    try {
      await api.put(`/intake-forms/templates/${id}/status`, { isActive: !isActive });
      loadTemplates();
    } catch {}
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return;
    try {
      await api.delete(`/intake-forms/templates/${id}`);
      loadTemplates();
    } catch {}
  }

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  if (showEditor) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{editing ? 'Edit Template' : 'New Template'}</h2>
          <button onClick={() => setShowEditor(false)} className="btn-secondary text-sm">Back to List</button>
        </div>
        <div className="card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Template Name *</label>
              <input value={templateName} onChange={e => setTemplateName(e.target.value)} className="input" placeholder="e.g., New Patient Intake" />
            </div>
            <div>
              <label className="label">Description</label>
              <input value={templateDesc} onChange={e => setTemplateDesc(e.target.value)} className="input" placeholder="Brief description..." />
            </div>
          </div>
        </div>

        {sections.map((section, si) => (
          <div key={si} className="card space-y-3">
            <div className="flex items-center gap-2">
              <input
                value={section.title}
                onChange={e => updateSection(si, e.target.value)}
                className="input flex-1 font-medium"
                placeholder="Section title..."
              />
              {sections.length > 1 && (
                <button onClick={() => removeSection(si)} className="text-xs text-red-500 underline whitespace-nowrap">Remove Section</button>
              )}
            </div>
            <div className="space-y-2">
              {section.fields.map((field, fi) => (
                <div key={fi} className="flex items-start gap-2 bg-slate-50 rounded-lg p-2">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      value={field.label}
                      onChange={e => updateField(si, fi, { label: e.target.value })}
                      className="input text-sm sm:col-span-2"
                      placeholder="Field label..."
                    />
                    <select
                      value={field.field_type}
                      onChange={e => updateField(si, fi, { field_type: e.target.value })}
                      className="input text-sm"
                    >
                      {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={e => updateField(si, fi, { required: e.target.checked })}
                        />
                        Required
                      </label>
                    </div>
                  </div>
                  {field.field_type === 'select' && (
                    <input
                      value={field.options}
                      onChange={e => updateField(si, fi, { options: e.target.value })}
                      className="input text-xs w-40"
                      placeholder="opt1,opt2,opt3"
                    />
                  )}
                  <button onClick={() => removeField(si, fi)} className="text-red-400 hover:text-red-600 text-sm mt-1">X</button>
                </div>
              ))}
            </div>
            <button onClick={() => addField(si)} className="text-xs text-primary-600 underline">+ Add Field</button>
          </div>
        ))}

        <div className="flex gap-2 justify-between">
          <button onClick={addSection} className="btn-secondary text-sm">+ Add Section</button>
          <div className="flex gap-2">
            <button onClick={() => setShowEditor(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} className="btn-primary">{editing ? 'Update Template' : 'Create Template'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-500">{templates.length} template{templates.length !== 1 ? 's' : ''}</span>
        <button onClick={openNew} className="btn-primary">+ New Template</button>
      </div>
      {templates.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No form templates yet. Create one to get started.</div>
      ) : (
        <div className="space-y-2">
          {templates.map(tmpl => (
            <div key={tmpl.id} className="card flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{tmpl.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${tmpl.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {tmpl.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {tmpl.description && <p className="text-xs text-slate-500 truncate">{tmpl.description}</p>}
                <div className="text-xs text-slate-400 mt-1">{tmpl.section_count} sections, {tmpl.field_count} fields</div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(tmpl)} className="text-xs text-primary-600 underline">Edit</button>
                <button onClick={() => toggleActive(tmpl.id, tmpl.is_active)} className="text-xs text-slate-500 underline">{tmpl.is_active ? 'Deactivate' : 'Activate'}</button>
                <button onClick={() => handleDelete(tmpl.id)} className="text-xs text-red-500 underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionList() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [patients, setPatients] = useState<any[]>([]);

  // Send form
  const [showSend, setShowSend] = useState(false);
  const [sendPatientId, setSendPatientId] = useState('');
  const [sendTemplateId, setSendTemplateId] = useState('');
  const [sending, setSending] = useState(false);

  // Review detail
  const [reviewing, setReviewing] = useState<SubmissionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => { loadInitial(); }, []);
  useEffect(() => { loadSubmissions(); }, [statusFilter]);

  async function loadInitial() {
    try {
      const [tmplRes, ptRes] = await Promise.all([
        api.get<any>('/intake-forms/templates?activeOnly=true'),
        api.get<any>('/patients?limit=200'),
      ]);
      setTemplates(tmplRes.data || []);
      setPatients(ptRes.data || []);
    } catch {}
    loadSubmissions();
  }

  async function loadSubmissions() {
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api.get<any>(`/intake-forms/submissions${qs}`);
      setSubmissions(res.data || []);
    } catch {} finally { setLoading(false); }
  }

  async function handleSendForm(e: React.FormEvent) {
    e.preventDefault();
    if (!sendPatientId || !sendTemplateId) return;
    setSending(true);
    try {
      await api.post('/intake-forms/submissions', {
        patientId: sendPatientId,
        templateId: sendTemplateId,
      });
      setShowSend(false);
      setSendPatientId('');
      setSendTemplateId('');
      loadSubmissions();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to send form');
    } finally { setSending(false); }
  }

  async function openReview(id: string) {
    setLoadingDetail(true);
    try {
      const res = await api.get<any>(`/intake-forms/submissions/${id}`);
      setReviewing(res.data || null);
    } catch {} finally { setLoadingDetail(false); }
  }

  async function markReviewed(id: string) {
    try {
      await api.put(`/intake-forms/submissions/${id}/review`);
      setReviewing(null);
      loadSubmissions();
    } catch {}
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'sent': return 'bg-blue-100 text-blue-700';
      case 'opened': return 'bg-yellow-100 text-yellow-700';
      case 'completed': return 'bg-green-100 text-green-700';
      case 'reviewed': return 'bg-slate-100 text-slate-700';
      case 'expired': return 'bg-red-100 text-red-500';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input max-w-xs">
          <option value="">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="opened">Opened</option>
          <option value="completed">Completed</option>
          <option value="reviewed">Reviewed</option>
          <option value="expired">Expired</option>
        </select>
        <button onClick={() => setShowSend(!showSend)} className="btn-primary">Send Form</button>
      </div>

      {showSend && (
        <form onSubmit={handleSendForm} className="card space-y-3">
          <h3 className="font-semibold text-sm">Send Intake Form</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Patient *</label>
              <select value={sendPatientId} onChange={e => setSendPatientId(e.target.value)} required className="input">
                <option value="">Select patient...</option>
                {patients.map((p: any) => <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Form Template *</label>
              <select value={sendTemplateId} onChange={e => setSendTemplateId(e.target.value)} required className="input">
                <option value="">Select form...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowSend(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={sending} className="btn-primary">{sending ? 'Sending...' : 'Send Form Link'}</button>
          </div>
        </form>
      )}

      {/* Review modal */}
      {(reviewing || loadingDetail) && (
        <div className="card space-y-3">
          {loadingDetail ? (
            <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
          ) : reviewing ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{reviewing.template_name}</h3>
                  <p className="text-xs text-slate-500">{reviewing.patient_last_name}, {reviewing.patient_first_name}</p>
                </div>
                <button onClick={() => setReviewing(null)} className="text-xs text-slate-400 underline">Close</button>
              </div>
              {reviewing.responses.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-4">No responses submitted yet</div>
              ) : (
                <div className="divide-y">
                  {(() => {
                    let currentSection = '';
                    return reviewing.responses.map((r, i) => {
                      const showHeader = r.section !== currentSection;
                      currentSection = r.section;
                      return (
                        <div key={i}>
                          {showHeader && <div className="text-xs font-medium text-slate-500 pt-3 pb-1">{r.section}</div>}
                          <div className="flex justify-between py-2 text-sm">
                            <span className="text-slate-600">{r.label}</span>
                            <span className="font-medium text-slate-900 text-right max-w-[60%]">
                              {r.field_type === 'checkbox' ? (r.value === 'true' ? 'Yes' : 'No') : (r.value || '-')}
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
              {reviewing.status === 'completed' && (
                <div className="flex justify-end pt-2">
                  <button onClick={() => markReviewed(reviewing.id)} className="btn-primary text-sm">Mark as Reviewed</button>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Submissions table */}
      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : submissions.length === 0 ? (
        <div className="card text-center text-slate-500 py-8">No submissions found. Send a form to a patient to get started.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Patient</th>
                <th className="text-left px-4 py-3">Form</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Sent</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Completed</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {submissions.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{s.patient_last_name}, {s.patient_first_name}</td>
                  <td className="px-4 py-3">{s.template_name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(s.status)}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{new Date(s.sent_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{s.completed_at ? new Date(s.completed_at).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {(s.status === 'completed' || s.status === 'reviewed') && (
                        <button onClick={() => openReview(s.id)} className="text-xs text-primary-600 underline">Review</button>
                      )}
                      {s.reviewed_by_name && <span className="text-xs text-slate-400">by {s.reviewed_by_name}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
