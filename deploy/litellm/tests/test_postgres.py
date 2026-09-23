import json
import os
import unittest
from uuid import uuid4
from hooks.activity.store import PostgresStore
from hooks.activity.events import validate_event


@unittest.skipUnless(os.getenv('LITELLM_TEST_DATABASE_URL'), 'No test database configured')
class DatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_later_hook_failure_rolls_back_default_team_and_activity_schema(self):
        import asyncpg
        from hooks.jwt_auth import initialize as initialize_team
        from hooks.activity import initialize as initialize_activity
        connection = await asyncpg.connect(os.environ['LITELLM_TEST_DATABASE_URL'])
        try:
            await connection.execute('CREATE TEMP TABLE "LiteLLM_TeamTable" ('
                'team_id text PRIMARY KEY, team_alias text, admins text[], members text[], '
                'members_with_roles jsonb, metadata jsonb, models text[])')
            await connection.execute('CREATE TEMP TABLE activity_init_test (user_id text PRIMARY KEY)')

            class TemporarySchemaConnection:
                async def execute(self, sql, *args):
                    # Exercise the real DDL without touching any persistent table.
                    sql = sql.replace('public."LiteLLM_EndUserTable"', 'pg_temp.activity_init_test')
                    return await connection.execute(sql, *args)

            with self.assertRaisesRegex(RuntimeError, 'Later hook failed'):
                async with connection.transaction():
                    target = TemporarySchemaConnection()
                    await initialize_team(target, {'LITELLM_DEFAULT_TEAM_ID': 'standard'})
                    await initialize_activity(target, {})
                    raise RuntimeError('Later hook failed')
            self.assertEqual(await connection.fetchval('SELECT count(*) FROM "LiteLLM_TeamTable"'), 0)
            self.assertFalse(await connection.fetchval(
                "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE "
                "attrelid='pg_temp.activity_init_test'::regclass AND attname='metadata' AND NOT attisdropped)"))
        finally:
            await connection.close()

    async def test_default_team_init_preserves_live_admin_changes(self):
        import asyncpg
        from hooks.jwt_auth import initialize
        connection = await asyncpg.connect(os.environ['LITELLM_TEST_DATABASE_URL'])
        try:
            await connection.execute('CREATE TEMP TABLE "LiteLLM_TeamTable" ('
                'team_id text PRIMARY KEY, team_alias text, admins text[], members text[], '
                'members_with_roles jsonb, metadata jsonb, models text[], max_budget float, blocked boolean)')
            environment = {'LITELLM_DEFAULT_TEAM_ID': 'standard'}
            await initialize(connection, environment)
            first = await connection.fetchrow('SELECT * FROM "LiteLLM_TeamTable"')
            self.assertEqual(first['models'], [])
            self.assertEqual(json.loads(first['metadata']), {'jwt_managed': True})
            await connection.execute('UPDATE "LiteLLM_TeamTable" SET '
                "models=ARRAY['model-a'], members=ARRAY['alice'], max_budget=12, blocked=true")
            before = dict(await connection.fetchrow('SELECT * FROM "LiteLLM_TeamTable"'))
            await initialize(connection, environment)
            after = dict(await connection.fetchrow('SELECT * FROM "LiteLLM_TeamTable"'))
            self.assertEqual(after, before)
        finally:
            await connection.close()

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
