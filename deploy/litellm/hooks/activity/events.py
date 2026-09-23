"""Activity payload validation and pure state aggregation."""
import json
from uuid import UUID


def merge_activity(metadata, event, now):
    event_id, _, event_type, supplied = event
    metadata = dict(metadata or {})
    activity = dict(metadata.get('customer_activity') or {})
    seen = list(activity.get('recent_event_ids') or [])
    duplicate = str(event_id) in seen

    timestamp = now.isoformat()
    day = timestamp[:10]
    days = dict(activity.get('days') or {})
    today = dict(days.get(day) or {'first_seen_at': timestamp, 'start_count': 0})
    today['last_seen_at'] = timestamp

    # Retries still prove current activity, but must not count another start/login.
    if event_type == 'startup' and not duplicate:
        today['start_count'] += 1
        activity['last_started_at'] = timestamp
    if event_type == 'login' and not duplicate:
        activity['last_login_reported_at'] = timestamp
    days[day] = today
    activity.update(
        last_seen_at=timestamp,
        metadata=json.loads(supplied),
        days={k: days[k] for k in sorted(days)[-90:]},
        recent_event_ids=(seen if duplicate else seen + [str(event_id)])[-256:],
    )
    metadata['customer_activity'] = activity
    return metadata


def validate_event(value):
    if not isinstance(value, dict):
        raise ValueError('Expected an object')

    event_id = UUID(value['event_id'])
    user_id = value['user_id']
    if not isinstance(user_id, str) or not user_id.strip() or len(user_id) > 512:
        raise ValueError('Invalid user_id')

    event_type = value['event_type']
    if event_type not in ('startup', 'heartbeat', 'login'):
        raise ValueError('Invalid event_type')

    metadata = value.get('metadata', {})
    if not isinstance(metadata, dict):
        raise ValueError('Invalid metadata')
    allowed = {'userName', 'loginTime', 'productName', 'version', 'clientTime'}
    if set(metadata) - allowed:
        raise ValueError('Unsupported metadata fields')
    if any(not isinstance(v, str) or len(v) > 512 for v in metadata.values()):
        raise ValueError('Invalid metadata value')
    return event_id, user_id.strip(), event_type, json.dumps(metadata)
