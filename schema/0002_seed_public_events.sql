INSERT OR IGNORE INTO event (id, title, type, starts_at, ends_at, location, capacity, publish_state)
VALUES
  (
    'ev_virtual_support_group',
    'Virtual Support Group',
    'support_group',
    '2026-07-08 17:00',
    '2026-07-08 18:00',
    'Google Meet',
    NULL,
    'published'
  ),
  (
    'ev_memory_social_jul18',
    'Memory Social - Drop-In Respite',
    'memory_social',
    '2026-07-18 10:00',
    '2026-07-18 13:00',
    'Community Room',
    12,
    'published'
  ),
  (
    'ev_wellness_grant_info_aug01',
    'Wellness Grant Info Session',
    'wellness',
    '2026-08-01 11:00',
    NULL,
    'Virtual',
    NULL,
    'published'
  ),
  (
    'ev_memory_social_caregiver_aug15',
    'Memory Social Caregiver Event',
    'caregiver_event',
    '2026-08-15 10:00',
    '2026-08-15 13:00',
    'Community Room',
    12,
    'published'
  );
