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
        self.db.execute("UPDATE respite_request SET status='confirmed',needs_review=0,reviewed_by='staff',reviewed_at='now',reviewed_revision=revision WHERE id='a'")
        self.db.execute("INSERT INTO registration VALUES(1,'owner','session','registered')")
        self.db.execute("UPDATE respite_request SET registration_id=1 WHERE id='a'")
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
            self.db.execute("UPDATE respite_request SET details_json=NULL,status='withdrawn',needs_review=1,revision=2,reviewed_by=NULL,reviewed_at=NULL,reviewed_revision=NULL,removed_at='now' WHERE id='a'")
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

if __name__ == '__main__':
    unittest.main()
