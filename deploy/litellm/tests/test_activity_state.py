import json
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from hooks.activity.events import merge_activity, validate_event
from hooks.activity.store import validate_database_url


class ActivityStateTests(unittest.TestCase):
    def event(self, event_id=None, client_time='2026-09-22T12:00:00Z'):
        return validate_event({
            'event_id': event_id or str(uuid4()),
            'user_id': 'test',
            'event_type': 'startup',
            'metadata': {'clientTime': client_time},
        })

    def test_cross_day_retry_updates_presence_without_counting_another_start(self):
        first_time = datetime(2026, 9, 22, 12, tzinfo=timezone.utc)
        event = self.event()
        first = merge_activity({'other': True}, event, first_time)
        retry = self.event(str(event[0]), '2026-09-23T12:00:00Z')
        result = merge_activity(first, retry, first_time + timedelta(days=1))
        activity = result['customer_activity']

        self.assertTrue(result['other'])
        self.assertEqual(activity['days']['2026-09-22']['start_count'], 1)
        self.assertEqual(activity['days']['2026-09-23']['start_count'], 0)
        self.assertEqual(activity['last_started_at'], first_time.isoformat())
        self.assertEqual(activity['last_seen_at'], (first_time + timedelta(days=1)).isoformat())
        self.assertEqual(activity['metadata']['clientTime'], '2026-09-23T12:00:00Z')
        self.assertEqual(len(activity['recent_event_ids']), 1)

    def test_same_day_retry_does_not_mutate_input_or_double_count(self):
        now = datetime(2026, 9, 22, tzinfo=timezone.utc)
        event = self.event()
        first = merge_activity({}, event, now)
        snapshot = json.dumps(first)
        result = merge_activity(first, event, now + timedelta(minutes=1))
        self.assertEqual(json.dumps(first), snapshot)
        self.assertEqual(result['customer_activity']['days']['2026-09-22']['start_count'], 1)

    def test_retention_limits(self):
        state = {}
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for day in range(300):
            state = merge_activity(state, self.event(), now + timedelta(days=day))
        self.assertEqual(len(state['customer_activity']['days']), 90)
        self.assertEqual(len(state['customer_activity']['recent_event_ids']), 256)


class DatabaseUrlTests(unittest.TestCase):
    def test_accepts_postgres_options_without_rewriting_schema(self):
        uri = 'postgresql://user:secret@localhost/db?sslmode=require&search_path=public'
        self.assertEqual(validate_database_url(uri), uri)

    def test_rejects_prisma_options_without_leaking_credentials(self):
        for option in ('schema=public', 'connection_limit=5', 'pool_timeout=10'):
            with self.subTest(option=option):
                with self.assertRaises(ValueError) as error:
                    validate_database_url('postgresql://user:private-password@localhost/db?' + option)
                self.assertNotIn('private-password', str(error.exception))

    def test_rejects_invalid_uri(self):
        for uri in ('', 'https://localhost/db', 'postgresql://[broken'):
            with self.subTest(uri=uri), self.assertRaises(ValueError):
                validate_database_url(uri)
