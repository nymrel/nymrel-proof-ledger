#!/usr/bin/env python3
"""Setup script for nymrel-proof-ledger."""

from setuptools import setup, find_packages

setup(
    name="nymrel-proof-ledger",
    version="1.0.0",
    package_dir={"": "python"},
    packages=find_packages(where="python"),
    install_requires=[],
    entry_points={
        "console_scripts": [
            "proof-ledger-py=nymrel_proof_ledger.cli:main",
        ],
    },
)
