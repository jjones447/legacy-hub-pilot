-- Synthetic fixtures for backup & restore round-trip drill
INSERT OR IGNORE INTO caregiver (
  id, first_name, last_name, email, phone, preferred_contact, caring_for, relationship, segment_tags, status, outcome_status, outcome_notes, outcome_updated_at
) VALUES (
  'cg_drill_jane_01', 'Jane', 'DrillCare', 'jane.drill@example.invalid', '555-0144', 'email', 'Mother with Alzheimers', 'daughter', '["carer","support_group"]', 'active', 'improving', 'Acute isolation reduced through support program', datetime('now')
);

INSERT OR IGNORE INTO grant_application (
  id, caregiver_id, requested_for, status, review_notes, source, external_ref
) VALUES (
  2001, 'cg_drill_jane_01', 'Dementia respite and caregiver course', 'closed', 'Approved by committee', 'staff', 'ref_drill_ga_01'
);

INSERT OR IGNORE INTO award (
  id, grant_application_id, amount, care_package, outcome
) VALUES (
  3001, 2001, '$500', 'Weekend Respite & Dementia Care Package', 'Completed respite training course'
);

INSERT OR IGNORE INTO followup (
  id, caregiver_id, kind, detail, status, source
) VALUES (
  4001, 'cg_drill_jane_01', 'wellness_check', 'Post-respite outcome follow-up call', 'open', 'staff'
);

INSERT OR IGNORE INTO contact_history (
  caregiver_id, occurred_at, channel, direction, summary, recorded_by
) VALUES (
  'cg_drill_jane_01', '2026-09-24T10:00:00Z', 'phone', 'inbound', 'Caregiver inquired about respite grant schedule', 'dev-tester@example.test'
);

INSERT OR IGNORE INTO note (
  caregiver_id, author, body, visibility, status
) VALUES (
  'cg_drill_jane_01', 'dev-tester@example.test', 'Caregiver attended Saturday orientation; package delivered successfully.', 'staff', 'active'
);

INSERT OR IGNORE INTO agent_change (
  id, area, operation, target_id, payload_json, status, requested_by
) VALUES (
  'ac_drill_01', 'caregiver', 'update', 'cg_drill_jane_01', '{"outcome_status":"improving"}', 'published', 'dev-agent@example.test'
);

INSERT INTO audit_log (
  actor, action, entity, entity_id, before_json, after_json
) VALUES (
  'dev-tester@example.test', 'grant_application.close', 'grant_application', '2001', '{"status":"course_complete"}', '{"status":"closed"}'
);
