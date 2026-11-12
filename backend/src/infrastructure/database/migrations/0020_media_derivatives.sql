-- Derived images (e.g. a JPEG copy of a PNG for Instagram, or a resized thumbnail) are ordinary assets that remember their source.
ALTER TABLE media_assets ADD COLUMN derived_from uuid, ADD COLUMN derivation jsonb;
CREATE INDEX media_assets_derived_idx ON media_assets(derived_from) WHERE derived_from IS NOT NULL;
