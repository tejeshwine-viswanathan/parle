#!/usr/bin/env python
"""One-time setup: download and install the offline FR<->EN Argos Translate
models used by backend/translate.py.

Run from the repo root with the backend venv active:

    python scripts/install_translate_models.py

Needs a network connection once, to fetch the models; translation runs fully
offline afterward, same as the Piper voices and faster-whisper model.
"""

from __future__ import annotations

import argostranslate.package

PAIRS = [("fr", "en"), ("en", "fr")]


def main() -> None:
    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    installed = {(pkg.from_code, pkg.to_code) for pkg in argostranslate.package.get_installed_packages()}

    for from_code, to_code in PAIRS:
        if (from_code, to_code) in installed:
            print(f"{from_code} -> {to_code}: already installed")
            continue
        pkg = next(p for p in available if p.from_code == from_code and p.to_code == to_code)
        print(f"{from_code} -> {to_code}: downloading and installing...")
        argostranslate.package.install_from_path(pkg.download())

    print("Done.")


if __name__ == "__main__":
    main()
