import { useState, useRef } from 'react';
import { api, ApiError } from '../services/api';

interface PreviewData {
  totalRows: number;
  validRows: number;
  mappedFields: Array<{ csvField: string; mapsTo: string }>;
  unmappedFields: string[];
  preview: Array<Record<string, string>>;
  errors: Array<{ row: number; reason: string }>;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

type Step = 'upload' | 'preview' | 'importing' | 'done';
type ImportType = 'patients' | 'appointments';

const TYPE_INFO: Record<ImportType, { label: string; description: string; instructions: string[] }> = {
  patients: {
    label: 'Patients',
    description: 'Import patient demographics, contact info, insurance, and diagnoses',
    instructions: [
      'In Practice Perfect, go to <strong>Reports</strong> > <strong>Client Listing</strong>',
      'Select the fields you want to export (name, DOB, phone, etc.)',
      'Click <strong>Export</strong> and save as CSV',
      'Upload the CSV file here',
    ],
  },
  appointments: {
    label: 'Schedule / Appointments',
    description: 'Import appointment history. Patients must be imported first so they can be matched.',
    instructions: [
      'In Practice Perfect, go to <strong>Reports</strong> > <strong>Appointment Listing</strong>',
      'Include: Date, Time, Patient Name, Therapist, Type, and Status',
      'Click <strong>Export</strong> and save as CSV',
      'Upload the CSV file here (import patients first!)',
    ],
  },
};

export default function ImportPage() {
  const [importType, setImportType] = useState<ImportType>('patients');
  const [step, setStep] = useState<Step>('upload');
  const [csvData, setCsvData] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [duplicateHandling, setDuplicateHandling] = useState('skip');
  const [defaultDuration, setDefaultDuration] = useState(45);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');

    const text = await file.text();
    setCsvData(text);

    setLoading(true);
    try {
      const res = await api.post<any>('/import/preview', { csv: text, type: importType });
      setPreview(res.data);
      setStep('preview');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to parse CSV');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setStep('importing');
    setError('');
    try {
      const endpoint = importType === 'patients' ? '/import/patients' : '/import/appointments';
      const body: Record<string, unknown> = { csv: csvData };
      if (importType === 'patients') body.duplicateHandling = duplicateHandling;
      if (importType === 'appointments') body.defaultDuration = defaultDuration;
      const res = await api.post<any>(endpoint, body);
      setResult(res.data);
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
      setStep('preview');
    }
  }

  function reset() {
    setStep('upload');
    setCsvData('');
    setPreview(null);
    setResult(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function downloadTemplate(type: ImportType) {
    const templates: Record<ImportType, { filename: string; headers: string }> = {
      patients: {
        filename: 'emr_os_patient_import_template.csv',
        headers: 'First Name,Last Name,Date of Birth,Gender,Phone,Email,Address,City,State,Zip,Emergency Contact,Emergency Phone,Primary Diagnosis,Referring Provider,Referral Source,Insurance,Member ID,Group Number,MRN,Status',
      },
      appointments: {
        filename: 'emr_os_appointment_import_template.csv',
        headers: 'Appointment Date,Start Time,End Time,Duration,Patient First Name,Patient Last Name,MRN,Therapist,Appointment Type,Status,Notes',
      },
    };
    const t = templates[type];
    const blob = new Blob([t.headers + '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const info = TYPE_INFO[importType];
  const itemLabel = importType === 'patients' ? 'Patient' : 'Appointment';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Import from Practice Perfect</h2>
          <p className="text-sm text-slate-500 mt-1">Import data from a Practice Perfect CSV export</p>
        </div>
        <button onClick={() => downloadTemplate(importType)} className="btn-secondary text-sm">
          Download Template
        </button>
      </div>

      {/* Import type selector */}
      {step === 'upload' && (
        <div className="flex gap-3">
          {(Object.keys(TYPE_INFO) as ImportType[]).map(type => (
            <button
              key={type}
              onClick={() => { setImportType(type); reset(); }}
              className={`flex-1 p-4 rounded-lg border-2 text-left transition-colors ${
                importType === type
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="font-medium text-sm">{TYPE_INFO[type].label}</div>
              <div className="text-xs text-slate-500 mt-1">{TYPE_INFO[type].description}</div>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="card">
          <h3 className="font-semibold mb-4">Step 1: Upload {info.label} CSV</h3>
          <p className="text-sm text-slate-500 mb-4">
            Export your {info.label.toLowerCase()} from Practice Perfect as a CSV file, then upload it here.
            The importer automatically maps Practice Perfect column names to EMR OS fields.
          </p>
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFile}
              className="hidden"
              id="csv-upload"
            />
            <label htmlFor="csv-upload" className="cursor-pointer">
              <div className="text-4xl mb-2">+</div>
              <div className="font-medium text-slate-700">Click to select CSV file</div>
              <div className="text-sm text-slate-400 mt-1">Supports .csv exports from Practice Perfect</div>
            </label>
          </div>
          {loading && (
            <div className="flex items-center gap-2 mt-4 text-sm text-slate-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
              Parsing CSV...
            </div>
          )}

          <div className="mt-6 bg-slate-50 rounded-lg p-4">
            <h4 className="font-medium text-sm mb-2">How to export from Practice Perfect</h4>
            <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
              {info.instructions.map((text, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: text }} />
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold mb-4">Step 2: Review Import Preview</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{preview.totalRows}</div>
                <div className="text-xs text-slate-500">Total Rows</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-700">{preview.validRows}</div>
                <div className="text-xs text-green-600">Valid</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-700">{preview.mappedFields.length}</div>
                <div className="text-xs text-blue-600">Mapped Fields</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">{preview.errors.length}</div>
                <div className="text-xs text-amber-600">Issues</div>
              </div>
            </div>

            {/* Field mapping */}
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2">Field Mapping</h4>
              <div className="flex flex-wrap gap-2">
                {preview.mappedFields.map(f => (
                  <span key={f.csvField} className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs px-2 py-1 rounded">
                    {f.csvField} &rarr; {f.mapsTo}
                  </span>
                ))}
              </div>
              {preview.unmappedFields.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs text-slate-400">Unmapped (will be ignored): </span>
                  {preview.unmappedFields.map(f => (
                    <span key={f} className="inline-flex items-center bg-slate-100 text-slate-500 text-xs px-2 py-1 rounded mr-1 mb-1">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Data preview table */}
            {preview.preview.length > 0 && (
              <div className="overflow-x-auto">
                <h4 className="text-sm font-medium mb-2">Data Preview (first 5 rows)</h4>
                <table className="w-full text-xs border">
                  <thead className="bg-slate-50">
                    <tr>
                      {Object.keys(preview.preview[0]).map(key => (
                        <th key={key} className="px-2 py-1 text-left border-b font-medium">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {Object.values(row).map((val, j) => (
                          <td key={j} className="px-2 py-1 border-b truncate max-w-[200px]">{val || '-'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Validation errors */}
            {preview.errors.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-amber-700 mb-2">Validation Issues</h4>
                <div className="bg-amber-50 rounded-lg p-3 text-sm space-y-1">
                  {preview.errors.map((e, i) => (
                    <div key={i} className="text-amber-800">Row {e.row}: {e.reason}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Import options */}
          <div className="card">
            <h4 className="font-medium mb-3">Import Options</h4>
            <div className="space-y-3">
              {importType === 'patients' && (
                <div>
                  <label className="label">Duplicate Handling</label>
                  <p className="text-xs text-slate-400 mb-1">
                    When a patient with the same name and DOB already exists:
                  </p>
                  <select
                    value={duplicateHandling}
                    onChange={e => setDuplicateHandling(e.target.value)}
                    className="input max-w-xs"
                  >
                    <option value="skip">Skip duplicates</option>
                    <option value="update">Update existing records</option>
                  </select>
                </div>
              )}
              {importType === 'appointments' && (
                <div>
                  <label className="label">Default Appointment Duration (minutes)</label>
                  <p className="text-xs text-slate-400 mb-1">
                    Used when no end time or duration is provided in the CSV:
                  </p>
                  <input
                    type="number"
                    value={defaultDuration}
                    onChange={e => setDefaultDuration(parseInt(e.target.value, 10) || 45)}
                    min={5}
                    max={480}
                    className="input max-w-[120px]"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={reset} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={preview.validRows === 0}
                className="btn-primary"
              >
                Import {preview.validRows} {itemLabel}{preview.validRows !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Importing */}
      {step === 'importing' && (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <div className="font-medium">Importing {info.label.toLowerCase()}...</div>
          <p className="text-sm text-slate-500 mt-1">This may take a moment for large files.</p>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && result && (
        <div className="card">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">&#10003;</div>
            <h3 className="text-xl font-bold text-green-700">Import Complete</h3>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-green-700">{result.imported}</div>
              <div className="text-sm text-green-600">Imported</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-slate-600">{result.skipped}</div>
              <div className="text-sm text-slate-500">Skipped</div>
            </div>
            <div className="bg-red-50 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-red-600">{result.errors.length}</div>
              <div className="text-sm text-red-500">Errors</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-red-700 mb-2">Errors</h4>
              <div className="bg-red-50 rounded-lg p-3 text-sm space-y-1 max-h-48 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <div key={i} className="text-red-800">Row {e.row}: {e.reason}</div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={reset} className="btn-secondary">Import More</button>
            <a href={importType === 'patients' ? '/patients' : '/schedule'} className="btn-primary inline-flex items-center">
              View {info.label}
            </a>
          </div>
        </div>
      )}

      {/* Supported fields info */}
      <div className="card bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-900 mb-2">Supported Fields — {info.label}</h4>
        <p className="text-sm text-blue-800 mb-2">
          The importer automatically recognizes column headers from Practice Perfect exports:
        </p>
        {importType === 'patients' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs text-blue-700">
            <span>First Name / Last Name</span>
            <span>Date of Birth / DOB</span>
            <span>Gender / Sex</span>
            <span>Phone / Cell Phone</span>
            <span>Email</span>
            <span>Address / City / State / Zip</span>
            <span>Emergency Contact</span>
            <span>Diagnosis / ICD-10</span>
            <span>Referring Provider</span>
            <span>Insurance / Payer</span>
            <span>Member ID / Policy #</span>
            <span>Group Number</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs text-blue-700">
            <span>Date / Appointment Date</span>
            <span>Start Time / Time</span>
            <span>End Time / Duration</span>
            <span>Patient Name / Client Name</span>
            <span>Patient First/Last Name</span>
            <span>MRN / Client ID</span>
            <span>Therapist / Provider</span>
            <span>Appointment Type / Visit Type</span>
            <span>Status</span>
            <span>Notes / Comments</span>
          </div>
        )}
      </div>
    </div>
  );
}
