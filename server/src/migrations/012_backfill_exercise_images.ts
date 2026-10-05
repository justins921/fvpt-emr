import { PoolClient } from 'pg';

// Migration 012 - Backfill image_url for global exercises.
// Images live in client/public/exercises/<slug>.jpg (served at /exercises/<slug>.jpg).
// Slug: lowercase, non-alphanumeric runs become single hyphens, trimmed.
// Only fills rows where image_url IS NULL (idempotent, never overwrites).

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function up(client: PoolClient): Promise<void> {
  const rowsResult = await client.query(
    'SELECT id, name, body_region FROM exercises ' +
    'WHERE is_global = true AND clinic_id IS NULL AND image_url IS NULL ' +
    'ORDER BY id'
  );
  const rows = rowsResult.rows as { id: string; name: string; body_region: string }[];

  const seen = new Set<string>();
  let updated = 0;
  for (const row of rows) {
    let slug = slugify(row.name);
    if (seen.has(slug)) {
      // Disambiguate repeat names (e.g. "Prone Hip Extension" exists for
      // lumbar and hip) with the body region - matches the image job.
      slug = slug + '-' + String(row.body_region).replace(/[^a-z0-9]+/g, '-');
    }
    seen.add(slug);
    await client.query('UPDATE exercises SET image_url = $1 WHERE id = $2', [
      '/exercises/' + slug + '.jpg',
      row.id,
    ]);
    updated++;
  }
  console.log('Backfilled image_url for ' + updated + ' global exercises');
}

export async function down(client: PoolClient): Promise<void> {
  await client.query(
    'UPDATE exercises SET image_url = NULL ' +
    "WHERE is_global = true AND clinic_id IS NULL AND image_url LIKE '/exercises/%'"
  );
}
