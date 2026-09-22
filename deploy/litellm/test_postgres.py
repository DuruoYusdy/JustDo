import json
import os
import unittest
from uuid import uuid4
from shared.proxy_hooks.activity import PostgresStore, validate_event


@unittest.skipUnless(os.getenv('LITELLM_TEST_DATABASE_URL'), 'No test database configured')
class DatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_atomic_metadata_preservation_and_deduplication(self):
        import asyncpg
        store = PostgresStore(os.environ['LITELLM_TEST_DATABASE_URL'])
        # A dedicated connection keeps the temporary table scoped to this test.
        connection = await asyncpg.connect(store.dsn)
        class Lease:
            async def __aenter__(self):
                return connection
            async def __aexit__(self, *args):
                pass
        class Pool:
            def acquire(self, **kwargs):
                return Lease()
        store.pool = Pool()
        try:
            await connection.execute('CREATE TEMP TABLE "LiteLLM_EndUserTable" (user_id text PRIMARY KEY, metadata jsonb, blocked boolean DEFAULT false, spend float DEFAULT 0, alias text)')
            await connection.execute('INSERT INTO "LiteLLM_EndUserTable" (user_id, metadata) VALUES ($1, $2::jsonb)', 'test', '{"other":true}')
            event = validate_event({'event_id': str(uuid4()), 'user_id': 'test', 'event_type': 'startup'})
            await store.record(event)
            await store.record(event)
            result = json.loads(await connection.fetchval('SELECT metadata FROM "LiteLLM_EndUserTable"'))
            self.assertTrue(result['other'])
            day = next(iter(result['customer_activity']['days'].values()))
            self.assertEqual(day['start_count'], 1)
            with self.assertRaises(LookupError):
                await store.record(validate_event({'event_id': str(uuid4()), 'user_id': 'missing', 'event_type': 'startup'}))
            new_event = validate_event({'event_id': str(uuid4()), 'user_id': 'new-user',
                                        'event_type': 'startup',
                                        'metadata': {'productName': 'Example', 'version': '2'}})
            await store.record(new_event, authenticated=True)
            await store.record(new_event, authenticated=True)
            row = await connection.fetchrow('SELECT * FROM "LiteLLM_EndUserTable" WHERE user_id=$1', 'new-user')
            self.assertEqual(row['alias'], 'Example 2')
            self.assertEqual(next(iter(json.loads(row['metadata'])['customer_activity']['days'].values()))['start_count'], 1)
            await connection.execute('UPDATE "LiteLLM_EndUserTable" SET blocked=true WHERE user_id=$1', 'new-user')
            with self.assertRaises(PermissionError):
                await store.record(new_event, authenticated=True)
        finally:
            await connection.close()
