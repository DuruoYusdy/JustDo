"""Mandatory JWT hook: installation and first-deployment default Team."""


def configure(settings):
    if (settings.get('custom_auth') != 'hooks.jwt_auth.handler.user_api_key_auth'
            or settings.get('custom_auth_run_common_checks') is not True):
        raise ValueError('Configure the JWT hook and common authorization checks')
    from .dispatch import install
    install()


async def initialize(connection, environ):
    team_id = environ.get('LITELLM_DEFAULT_TEAM_ID', '').strip()
    if not team_id:
        return
    # Existing membership, models, limits and metadata are owned by the UI.
    await connection.execute(
        'INSERT INTO "LiteLLM_TeamTable" '
        '(team_id, team_alias, admins, members, members_with_roles, metadata, models) '
        "VALUES ($1, 'Default', ARRAY[]::text[], ARRAY[]::text[], '[]'::jsonb, "
        "'{\"jwt_managed\":true}'::jsonb, ARRAY[]::text[]) "
        'ON CONFLICT (team_id) DO NOTHING', team_id)
