-- Seed in-scope content type schemas for Page Sections and Resource Hub Cards
INSERT OR IGNORE INTO content_type (id, json_schema)
VALUES (
  'page_section',
  '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"section_key":{"type":"string","enum":["home_hero","about_intro","programs_respite","programs_social","programs_wellness","contact_info"]},"heading":{"type":"string","maxLength":200},"body":{"type":"string","maxLength":2000},"cta_label":{"type":"string","maxLength":50},"cta_target":{"type":"string","enum":["membership_modal","support_request_form","events_list","contact_page","none"]}},"required":["section_key","heading","body"],"additionalProperties":false}'
);

INSERT OR IGNORE INTO content_type (id, json_schema)
VALUES (
  'resource',
  '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"title":{"type":"string","maxLength":100},"description":{"type":"string","maxLength":500},"category":{"type":"string","enum":["crisis","education","selfcare","support","financial"]},"link_or_file":{"type":"string","maxLength":300}},"required":["title","description","category"],"additionalProperties":false}'
);
