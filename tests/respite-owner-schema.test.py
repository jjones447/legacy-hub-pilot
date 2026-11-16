"""Inert candidate SQLite tests. No network, live D1, routes or activation."""
import sqlite3
import unittest
from pathlib import Path

SQL = Path(__file__).resolve().parents[1] / 'schema/candidates/respite_owner_lifecycle.sql'

class OwnerSchema(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript('''PRAGMA foreign_keys=ON;
        CREATE TABLE caregiver(id TEXT PRIMARY KEY);
        CREATE TABLE event(id TEXT PRIMARY KEY);
        CREATE TABLE registration(id INTEGER PRIMARY KEY, caregiver_id TEXT, event_id TEXT, status TEXT);
        INSERT INTO caregiver VALUES('owner'),('other'); INSERT INTO event VALUES('session');''')
        self.db.executescript(SQL.read_text())
        self.db.execute("INSERT INTO respite_participant(id,caregiver_id,details_json) VALUES('p','owner','{}')")
        self.db.execute("""INSERT INTO respite_request(id,caregiver_id,participant_id,event_id,request_key,payload_digest,details_json,participant_revision,first_time,privacy_version,nonmedical_version,acknowledged_at)
        VALUES('a','owner','p','session','key','digest','{}',1,0,'draft','draft','now')""")
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def confirm(self):
        self.db.execute("UPDATE respite_request SET status='confirmed',needs_review=0,reviewed_by='staff',reviewed_at='now',revision=revision+1,reviewed_revision=revision+1 WHERE id='a'")
        self.db.execute("INSERT INTO registration VALUES(1,'owner','session','registered')")
        self.db.execute("UPDATE respite_request SET registration_id=1,revision=revision+1,reviewed_revision=revision+1 WHERE id='a'")
        self.db.commit()

    def test_cross_owner_reference_and_reparenting_denied(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET caregiver_id='other' WHERE id='a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_participant SET caregiver_id='other',revision=2 WHERE id='p'")
        self.db.execute("INSERT INTO respite_participant(id,caregiver_id,details_json) VALUES('q','other','{}')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET participant_id='q' WHERE id='a'")

    def test_confirmation_requires_current_review(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET status='confirmed',needs_review=0 WHERE id='a'")
        self.confirm()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET revision=2 WHERE id='a'")

    def test_changed_details_cannot_keep_review_or_reservation(self):
        self.confirm()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET details_json='{\"mobility\":\"changed\"}',revision=2 WHERE id='a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET status='pending',needs_review=1,reviewed_by=NULL,reviewed_at=NULL,reviewed_revision=NULL WHERE id='a'")

    def test_atomic_redaction_cancels_and_blocks_generic_revival(self):
        self.confirm()
        with self.db:
            self.db.execute("UPDATE registration SET status='cancelled' WHERE id=1")
            self.db.execute("UPDATE respite_request SET details_json=NULL,participant_id=NULL,status='withdrawn',needs_review=1,revision=revision+1,reviewed_by=NULL,reviewed_at=NULL,reviewed_revision=NULL,removed_at='now' WHERE id='a'")
            self.db.execute("DELETE FROM respite_participant WHERE id='p'")
        self.assertEqual(self.db.execute("SELECT details_json,participant_id FROM respite_request").fetchone(), (None,None))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE registration SET status='registered' WHERE id=1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET removed_at=NULL WHERE id='a'")

    def test_failed_redaction_transaction_restores_capacity(self):
        self.confirm()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.db.execute("UPDATE registration SET status='cancelled' WHERE id=1")
                self.db.execute("UPDATE respite_request SET removed_at='now' WHERE id='a'")
        self.assertEqual(self.db.execute("SELECT status FROM registration").fetchone()[0], 'registered')

    def test_registration_cannot_unlink_or_bind_foreign_identity(self):
        self.confirm()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET registration_id=NULL,revision=revision+1,reviewed_revision=revision+1 WHERE id='a'")
        self.db.execute("INSERT INTO registration VALUES(2,'other','session','registered')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET registration_id=2,revision=revision+1,reviewed_revision=revision+1 WHERE id='a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE registration SET caregiver_id='other' WHERE id=1")
        # An unbound pending request cannot take a foreign owner's registration either.
        self.db.execute("INSERT INTO respite_request(id,caregiver_id,event_id,request_key,payload_digest,details_json,participant_revision,first_time,privacy_version,nonmedical_version,acknowledged_at) VALUES('b','owner','session','key-b','digest','{}',1,0,'draft','draft','now')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET registration_id=2,revision=revision+1 WHERE id='b'")
        self.db.execute("INSERT INTO event VALUES('different')")
        self.db.execute("INSERT INTO registration VALUES(3,'owner','different','registered')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET registration_id=3,revision=revision+1 WHERE id='b'")

    def test_status_regression_cannot_keep_old_review(self):
        self.confirm()
        self.db.execute("UPDATE registration SET status='cancelled' WHERE id=1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET status='withdrawn',revision=revision+1 WHERE id='a'")
        self.db.execute("UPDATE respite_request SET status='withdrawn',needs_review=1,reviewed_by=NULL,reviewed_at=NULL,reviewed_revision=NULL,revision=revision+1 WHERE id='a'")
        self.db.execute("UPDATE respite_request SET status='pending',revision=revision+1 WHERE id='a'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE respite_request SET status='confirmed',revision=revision+1 WHERE id='a'")

    def test_confirmed_participant_and_receipt_cannot_silently_change(self):
        self.confirm()
        self.db.execute("INSERT INTO respite_participant(id,caregiver_id,details_json) VALUES('q','owner','{}')")
        for column, value in [('participant_id','q'),('payload_digest','new'),('privacy_version','new'),('nonmedical_version','new'),('acknowledged_at','later')]:
            with self.subTest(column=column), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"UPDATE respite_request SET {column}=?,revision=revision+1,reviewed_revision=revision+1 WHERE id='a'", (value,))

    def test_all_request_writes_require_exact_next_revision(self):
        for revision in (1,0,3):
            with self.subTest(revision=revision), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE respite_request SET updated_at='later',revision=? WHERE id='a'", (revision,))
        self.db.execute("UPDATE respite_request SET updated_at='later',revision=2 WHERE id='a'")
        self.assertEqual(self.db.execute("SELECT revision FROM respite_request").fetchone()[0],2)

    def test_delete_requires_explicit_revision_unlink_of_every_pending_request(self):
        self.db.execute("INSERT INTO respite_request(id,caregiver_id,participant_id,event_id,request_key,payload_digest,details_json,participant_revision,first_time,privacy_version,nonmedical_version,acknowledged_at) VALUES('b','owner','p','session','key-b','digest','{}',1,0,'draft','draft','now')")
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.db.execute("UPDATE respite_request SET participant_id=NULL,revision=revision+1 WHERE id='a'")
                self.db.execute("DELETE FROM respite_participant WHERE id='p'")
        self.assertEqual(self.db.execute("SELECT count(*) FROM respite_request WHERE participant_id='p'").fetchone()[0],2)
        with self.db:
            for request in ('a','b'):
                self.db.execute("UPDATE respite_request SET participant_id=NULL,revision=revision+1 WHERE id=? AND revision=1", (request,))
            self.db.execute("DELETE FROM respite_participant WHERE id='p'")
        self.assertEqual(self.db.execute("SELECT count(*) FROM respite_participant").fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM respite_request WHERE revision=2 AND participant_id IS NULL").fetchone()[0],2)

if __name__ == '__main__':
    unittest.main()
