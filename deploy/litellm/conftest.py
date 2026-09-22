"""Use the same shared-module import path as the ASGI launchers."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / 'shared'))
