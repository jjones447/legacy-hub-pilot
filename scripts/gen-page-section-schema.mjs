#!/usr/bin/env node
// Generator for page_section JSON Schema (Slice D7-S0a, Deliverable 1 & 2 / Slice D7-S2B)
// Reads content/page-sections.json and emits schema/page_section.schema.json
// and schema/0010_page_section_forms.sql.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

export function isEditableField(fieldName, value) {
  // Not editable per contract:
  // - nested objects/arrays of objects (tiles, steps, timeline, rows, items)
  // - any *_html field
  // - cta_href
  if (fieldName.endsWith('_html') || fieldName === 'cta_href') {
    return false;
  }
  if (typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
    return true;
  }
  return false;
}

export function generatePageSectionSchema(
  contentPath = resolve(ROOT_DIR, 'content', 'page-sections.json')
) {
  const content = JSON.parse(readFileSync(contentPath, 'utf8'));
  const items = content.items || {};
  const sectionKeys = Object.keys(items);

  const oneOf = [];

  for (const [sectionKey, sectionObj] of Object.entries(items)) {
    const properties = {
      section_key: {
        type: 'string',
        const: sectionKey,
        enum: [sectionKey]
      }
    };

    for (const [fieldName, val] of Object.entries(sectionObj)) {
      if (isEditableField(fieldName, val)) {
        if (typeof val === 'string') {
          const maxLength = fieldName === 'title' ? 200 : 2000;
          properties[fieldName] = {
            type: 'string',
            maxLength
          };
        } else if (Array.isArray(val)) {
          properties[fieldName] = {
            type: 'array',
            maxItems: 12,
            items: {
              type: 'string',
              maxLength: 2000
            }
          };
        }
      } else {
        // Non-editable field present in data but marked readOnly in schema
        const type = Array.isArray(val) ? 'array' : typeof val;
        properties[fieldName] = {
          type,
          readOnly: true
        };
      }
    }

    oneOf.push({
      type: 'object',
      properties,
      required: ['section_key'],
      additionalProperties: false
    });
  }

  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      section_key: {
        type: 'string',
        enum: sectionKeys
      }
    },
    required: ['section_key'],
    oneOf
  };

  return schema;
}

export function generateMigrationSql(schema, migrationFile = '0010_page_section_forms.sql') {
  const schemaJson = JSON.stringify(schema);
  const escaped = schemaJson.replaceAll("'", "''");

  if (migrationFile.includes('0009')) {
    return `-- Migration 0009: Live content schema and draft targets (slice D7-S0a)
-- Updates page_section schema to match the 17 real page sections from content/page-sections.json.
-- Adds draft_of column to content_item to keep published targets untouched during drafting.

UPDATE content_type
SET json_schema = '${escaped}'
WHERE id = 'page_section';

ALTER TABLE content_item ADD COLUMN draft_of TEXT;

CREATE INDEX IF NOT EXISTS idx_content_item_draft_of ON content_item(draft_of);
`;
  }

  return `-- Migration 0010: Form wording and option lists schema (slice D7-S2B)
-- Updates page_section schema to include form.membership, form.grant_apply, form.coaching_interest, form.request_support.

UPDATE content_type
SET json_schema = '${escaped}'
WHERE id = 'page_section';
`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const schema = generatePageSectionSchema();
  const jsonStr = JSON.stringify(schema, null, 2) + '\n';

  if (process.argv.includes('--stdout')) {
    process.stdout.write(jsonStr);
  } else {
    const schemaOutPath = resolve(ROOT_DIR, 'schema', 'page_section.schema.json');
    writeFileSync(schemaOutPath, jsonStr, 'utf8');
    console.log(`[schema-gen] Emitted ${schemaOutPath}`);

    let migrationFile = '0010_page_section_forms.sql';
    const migIdx = process.argv.indexOf('--migration');
    if (migIdx !== -1 && process.argv[migIdx + 1]) {
      migrationFile = process.argv[migIdx + 1];
    }

    const sql = generateMigrationSql(schema, migrationFile);
    const sqlOutPath = resolve(ROOT_DIR, 'schema', migrationFile);
    writeFileSync(sqlOutPath, sql, 'utf8');
    console.log(`[schema-gen] Emitted ${sqlOutPath}`);
  }
}
