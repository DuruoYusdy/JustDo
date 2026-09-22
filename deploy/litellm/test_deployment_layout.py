"""Check both launch methods use the single shared implementation."""
from pathlib import Path
import subprocess
import sys
import unittest


class DeploymentLayoutTests(unittest.TestCase):
    def test_shared_entrypoint_imports_without_litellm_installed(self):
        root = Path(__file__).resolve().parent
        result = subprocess.run(
            [sys.executable, '-B', '-c', 'import proxy_app'],
            cwd=root / 'shared',
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_launchers_reference_shared_sources(self):
        root = Path(__file__).resolve().parent
        script = (root / 'native' / 'start.sh').read_text()
        self.assertIn('SHARED_DIR="$SCRIPT_DIR/../shared"', script)
        self.assertIn('--app-dir "$SHARED_DIR"', script)

        dockerfile = (root / 'docker' / 'Dockerfile').read_text()
        for name in ('proxy_app.py', 'proxy_hooks', 'requirements.txt'):
            self.assertIn('COPY shared/' + name, dockerfile)

        for directory in ('native', 'docker'):
            self.assertFalse((root / directory / 'proxy_app.py').exists())
            self.assertFalse((root / directory / 'proxy_hooks' / 'activity.py').exists())

    def test_docker_runtime_preserves_base_image_user(self):
        root = Path(__file__).resolve().parent
        dockerfile = (root / 'docker' / 'Dockerfile').read_text()
        runtime_stage = dockerfile.rsplit('FROM ${LITELLM_IMAGE}', 1)[1]
        self.assertNotIn('USER root', runtime_stage)
        self.assertIn('COPY --from=hook-dependencies', runtime_stage)
