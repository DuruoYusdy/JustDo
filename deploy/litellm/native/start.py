"""Launch LiteLLM or explicitly initialize its shared database."""
import argparse
import os
from pathlib import Path
import sys

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent


def build_launch(mode, inherited=None):
    if mode not in {"serve", "init"}:
        raise ValueError("Unknown launch mode.")
    environment = dict(os.environ if inherited is None else inherited)
    if not (ROOT / ".env").is_file():
        raise ValueError("Create native/.env before starting the service.")
    environment.update({key: value for key, value in dotenv_values(ROOT / ".env", interpolate=False).items()
                        if value is not None})
    for key, value in list(environment.items()):
        if key.startswith('JUSTDO_JWT_') or key == 'JUSTDO_DEFAULT_TEAM_ID':
            environment.setdefault(key.replace('JUSTDO_', 'LITELLM_', 1), value)
    required = ["DATABASE_URL", "LITELLM_MASTER_KEY", "LITELLM_SALT_KEY",
                "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD", "LITELLM_ACTIVITY_DATABASE_URL"]
    if mode == "serve":
        required += ["LITELLM_JWT_ISSUER", "LITELLM_JWT_AUDIENCE", "LITELLM_JWT_JWKS_URL"]
    if any(not environment.get(key, "").strip() or "replace-with-" in environment[key]
           for key in required):
        raise ValueError("Complete the required deployment settings in native/.env.")
    shared = ROOT.parent / "shared"
    environment["PYTHONPATH"] = os.pathsep.join([
        str(shared), str(ROOT.parent), environment.get("PYTHONPATH", "")])
    environment["LITELLM_MODE"] = "PRODUCTION"
    environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + environment.get("PATH", "")
    if mode == "init":
        return [sys.executable, str(shared / "init_database.py")], environment
    environment["CONFIG_FILE_PATH"] = str(ROOT / "config.yaml")
    port = environment.get("LITELLM_PORT", "9108")
    workers = environment.get("LITELLM_WORKERS", "4")
    environment["DISABLE_SCHEMA_UPDATE"] = "true"
    command = [sys.executable, "-m", "uvicorn", "proxy_app:create_app", "--factory",
               "--app-dir", str(shared), "--host", "127.0.0.1", "--port", port, "--workers", workers]
    return command, environment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="serve", choices=["serve", "init"])
    args = parser.parse_args()
    try:
        command, environment = build_launch(args.mode)
    except ValueError as error:
        parser.exit(2, str(error) + "\n")
    os.execve(command[0], command, environment)


if __name__ == "__main__":
    main()
