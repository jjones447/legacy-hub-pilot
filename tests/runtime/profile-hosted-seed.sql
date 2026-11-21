-- Exact synthetic-only seed candidate. NOT APPLIED.
-- Requires fresh zero collisions for all three IDs/emails, verified TEST identity,
-- refreshed bookmark/inventory, reviewed0022 installed once and active packet review.
-- Single INSERT, no UPSERT/REPLACE/UPDATE and no real/customer identifiers.
INSERT INTO caregiver (id,first_name,last_name,email,source,segment_tags,status,is_caregiver)
VALUES
 ('profile_ct13_20261121_a_571d390c','Fictional','Profile A','profile-fixture-a-571d390c@example.invalid','profile_qualification','["qa","profile_fixture"]','active',1),
 ('profile_ct13_20261121_b_82e4a90f','Fictional','Profile B','profile-fixture-b-82e4a90f@example.invalid','profile_qualification','["qa","profile_fixture"]','active',1),
 ('profile_ct13_20261121_archived_614ab108','Fictional','Profile archived','profile-fixture-archived-614ab108@example.invalid','profile_qualification','["qa","profile_fixture"]','archived',1);
