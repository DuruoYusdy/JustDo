"""Use a fresh interpreter to exercise LiteLLM's path-based custom hook loader."""
from pathlib import Path
import subprocess
import sys
import pytest


@pytest.mark.parametrize('directory', ['docker', 'native'])
def test_hook_loads_without_a_prior_module_import(directory):
    # Exercise the real loader with no cached hook module.
    root = Path(__file__).resolve().parents[1]
    config = root / directory / 'config.yaml'
    result = subprocess.run([
        sys.executable, "-c",
        "import sys; from litellm.proxy.types_utils.utils import get_instance_fn; "
        "assert 'hooks.jwt_auth.handler' not in sys.modules; "
        "assert callable(get_instance_fn('hooks.jwt_auth.handler.user_api_key_auth',sys.argv[1]))",
        str(config.resolve()),
    ], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
