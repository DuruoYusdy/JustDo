"""Optional legacy-activity smoke test; creates/removes one unique test customer.

Run in the LiteLLM container while activity compatibility is enabled. For native
deployment set LITELLM_SMOKE_BASE_URL=http://127.0.0.1:9108.
"""
import asyncio
import json
import os
import urllib.request
import urllib.error
from uuid import uuid4
import asyncpg


async def main():
    if not os.environ.get('LITELLM_ACTIVITY_TOKEN'):
        raise SystemExit('Legacy activity compatibility is disabled; use JWT integration tests instead.')
    base_url = os.getenv('LITELLM_SMOKE_BASE_URL', 'http://127.0.0.1:4000').rstrip('/')
    db = await asyncpg.connect(os.environ['LITELLM_ACTIVITY_DATABASE_URL'])
    user_id = 'activity-smoke-' + str(uuid4())
    try:
        await db.execute('INSERT INTO "LiteLLM_EndUserTable" (user_id, blocked, metadata) VALUES ($1, false, $2::jsonb)',
                         user_id, '{"preserved":true}')
        event = {'event_id': str(uuid4()), 'user_id': user_id, 'event_type': 'startup',
                 'metadata': {'productName': 'SmokeTest', 'version': '1'}}
        def post(token):
            request = urllib.request.Request(base_url + '/customer/activity',
                data=json.dumps(event).encode(), headers={'Authorization': 'Bearer ' + token,
                                                        'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code
        assert await asyncio.to_thread(post, 'invalid') == 401
        for _ in range(2):
            assert await asyncio.to_thread(post, os.environ['LITELLM_ACTIVITY_TOKEN']) == 200
        metadata = json.loads(await db.fetchval('SELECT metadata FROM "LiteLLM_EndUserTable" WHERE user_id=$1', user_id))
        assert metadata['preserved'] is True
        assert next(iter(metadata['customer_activity']['days'].values()))['start_count'] == 1
        print('HTTP authentication, persistence, metadata preservation and duplicate suppression: PASS')
    finally:
        await db.execute('DELETE FROM "LiteLLM_EndUserTable" WHERE user_id=$1', user_id)
        await db.close()
        print('Only the unique smoke-test customer was removed.')


if __name__ == '__main__':
    asyncio.run(main())
