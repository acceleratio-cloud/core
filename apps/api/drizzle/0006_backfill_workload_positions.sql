-- Existing workloads all started at { x: 0, y: 0 } because the canvas offset
-- duplicates only in the browser. Stagger them into the same four-column grid
-- that new workloads use, so stored and displayed positions agree.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id
      ORDER BY created_at, id
    ) - 1 AS slot
  FROM workload
  WHERE position = '{"x": 0, "y": 0}'::jsonb
)
UPDATE workload AS target
SET position = jsonb_build_object(
  'x', (ranked.slot % 4) * 320,
  'y', (ranked.slot / 4) * 300
)
FROM ranked
WHERE target.id = ranked.id;
