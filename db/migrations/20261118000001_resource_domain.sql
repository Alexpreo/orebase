-- migrate:up
-- category holds only the classification (measured, indicated, ...); the zone,
-- pit/underground or inclusive/exclusive-of-reserves qualifier goes in domain.
ALTER TABLE core.resource_estimates ADD COLUMN IF NOT EXISTS domain text;

CREATE OR REPLACE VIEW core.v_resource_estimates AS
SELECT id, project_id, document_id, effective_date, category, tonnes, grade,
       contained_metal, cutoff, standard, extraction_confidence, reviewed, domain
FROM core.resource_estimates;

-- migrate:down
CREATE OR REPLACE VIEW core.v_resource_estimates AS
SELECT id, project_id, document_id, effective_date, category, tonnes, grade,
       contained_metal, cutoff, standard, extraction_confidence, reviewed
FROM core.resource_estimates;
ALTER TABLE core.resource_estimates DROP COLUMN IF EXISTS domain;
