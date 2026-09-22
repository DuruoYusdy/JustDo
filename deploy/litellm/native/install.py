"""Create the local virtualenv, install the proxy, and generate its Prisma client."""
import os
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


def main():
    if not (3, 11) <= sys.version_info[:2] <= (3, 12):
        raise SystemExit("Use Python 3.11 or 3.12 for this deployment.")
    target = ROOT / ".venv"
    venv.EnvBuilder(with_pip=True).create(target)
    python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    environment = dict(os.environ)
    # Prisma invokes its generator by executable name; running the venv Python
    # alone does not activate its Scripts/bin directory for child processes.
    environment["PATH"] = str(python.parent) + os.pathsep + environment.get("PATH", "")
    subprocess.run([str(python), "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")],
                   check=True, env=environment)
    # Locate the schema in the installed distribution; no machine-specific path.
    code = (
        "import importlib.util,pathlib,subprocess,sys; "
        "schema=pathlib.Path(importlib.util.find_spec('litellm').origin).parent/'proxy'/'schema.prisma'; "
        "subprocess.run([sys.executable,'-m','prisma','generate','--schema',str(schema)],check=True)"
    )
    subprocess.run([str(python), "-c", code], check=True, env=environment)


if __name__ == "__main__":
    main()
