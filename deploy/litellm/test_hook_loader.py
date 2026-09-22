"""Use a fresh interpreter to exercise LiteLLM's path-based custom hook loader."""
from pathlib import Path
import subprocess
import sys


def test_hook_loads_without_a_prior_module_import():
    # Docker mounts custom_auth.py beside its YAML. The native loader differs:
    # it imports via PYTHONPATH. Do not let pytest's existing import mask this.
    config = Path(__file__).parent / "config-placeholder.yaml"
    result = subprocess.run([
        sys.executable, "-c",
        "import sys; from litellm.proxy.types_utils.utils import get_instance_fn; "
        "assert 'custom_auth' not in sys.modules; "
        "assert callable(get_instance_fn('custom_auth.user_api_key_auth',sys.argv[1]))",
        str(config.resolve()),
    ], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
