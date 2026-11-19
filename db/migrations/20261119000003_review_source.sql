-- migrate:up
-- Who signed off a row: 'human' (admin review page), 'auto_source_match' (every key figure
-- found in the row's own source document), or 'claude_read' (Claude read the source pages).
-- NULL while unreviewed. review_note says what was checked or corrected.
ALTER TABLE core.resource_estimates ADD COLUMN review_source text, ADD COLUMN review_note text;
ALTER TABLE core.project_economics  ADD COLUMN review_source text, ADD COLUMN review_note text;
ALTER TABLE core.drill_results      ADD COLUMN review_source text, ADD COLUMN review_note text;
UPDATE core.resource_estimates SET review_source = 'human' WHERE reviewed;
UPDATE core.project_economics  SET review_source = 'human' WHERE reviewed;
UPDATE core.drill_results      SET review_source = 'human' WHERE reviewed;

-- migrate:down
ALTER TABLE core.resource_estimates DROP COLUMN review_source, DROP COLUMN review_note;
ALTER TABLE core.project_economics  DROP COLUMN review_source, DROP COLUMN review_note;
ALTER TABLE core.drill_results      DROP COLUMN review_source, DROP COLUMN review_note;
