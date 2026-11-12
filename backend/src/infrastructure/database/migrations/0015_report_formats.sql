-- Exports can be CSV (text) or PDF (binary, stored base64).
ALTER TABLE export_jobs ADD COLUMN format text NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'pdf')), ADD COLUMN result_b64 text;
