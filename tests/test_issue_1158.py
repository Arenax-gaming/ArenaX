# -*- coding: utf-8 -*-
"""Regression and verification test suite for Issue #1158:
[backend] - Remove dead auth_service_updated.rs file and resolve dual auth service ambiguity
"""
import os
import sys
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


class TestIssue1158DualAuthServiceResolution(unittest.TestCase):
    """Verifies that auth_service_updated.rs has been removed and merged into auth_service.rs."""

    def setUp(self):
        self.backend_service_dir = os.path.join(REPO_ROOT, "backend", "src", "service")
        self.auth_service_path = os.path.join(self.backend_service_dir, "auth_service.rs")
        self.dead_auth_service_path = os.path.join(self.backend_service_dir, "auth_service_updated.rs")
        self.mod_rs_path = os.path.join(self.backend_service_dir, "mod.rs")

    def test_01_dead_file_removed_and_canonical_file_exists(self):
        """Verify auth_service_updated.rs is completely removed and auth_service.rs is the single authoritative service."""
        self.assertTrue(
            os.path.exists(self.auth_service_path),
            f"Authoritative auth_service.rs must exist at {self.auth_service_path}",
        )
        self.assertFalse(
            os.path.exists(self.dead_auth_service_path),
            f"Dead file auth_service_updated.rs must not exist at {self.dead_auth_service_path}",
        )

    def test_02_no_orphaned_imports_across_repo(self):
        """Verify no orphaned imports or references to auth_service_updated exist in codebase."""
        orphaned_references = []
        for root, dirs, files in os.walk(os.path.join(REPO_ROOT, "backend")):
            # Ignore target and hidden directories
            if "target" in root or ".git" in root:
                continue
            for file in files:
                if file.endswith(".rs") or file.endswith(".toml"):
                    file_path = os.path.join(root, file)
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        for line_idx, line in enumerate(f, 1):
                            stripped = line.strip()
                            if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                                continue
                            if "auth_service_updated" in line:
                                orphaned_references.append(f"{file_path}:{line_idx}: {stripped}")

        self.assertEqual(
            orphaned_references,
            [],
            f"Found orphaned references to auth_service_updated: {orphaned_references}",
        )

    def test_03_service_mod_exports_single_auth_service(self):
        """Verify backend/src/service/mod.rs declares pub mod auth_service and not auth_service_updated."""
        self.assertTrue(os.path.exists(self.mod_rs_path), "mod.rs must exist")
        with open(self.mod_rs_path, "r", encoding="utf-8") as f:
            mod_content = f.read()

        self.assertIn(
            "pub mod auth_service;",
            mod_content,
            "mod.rs must expose pub mod auth_service;",
        )
        self.assertNotIn(
            "auth_service_updated",
            mod_content,
            "mod.rs must not declare or reference auth_service_updated",
        )

    def test_04_retained_improvements_in_canonical_auth_service(self):
        """Verify unique improvements from auth_service_updated.rs are preserved in auth_service.rs."""
        with open(self.auth_service_path, "r", encoding="utf-8") as f:
            auth_content = f.read()

        # Pin tests and validations preserved from auth_service_updated.rs
        self.assertIn(
            "bcrypt_hash_round_trips_and_rejects_wrong_password",
            auth_content,
            "bcrypt hash verification test from auth_service_updated.rs must be retained",
        )
        self.assertIn(
            "test_password_validation",
            auth_content,
            "password validation unit test from auth_service_updated.rs must be retained",
        )
        self.assertIn(
            "test_password_length_boundary",
            auth_content,
            "password length boundary test must be present",
        )

    def test_05_boundary_guards_implemented(self):
        """Verify boundary checks are in place for login and change_password."""
        with open(self.auth_service_path, "r", encoding="utf-8") as f:
            auth_content = f.read()

        self.assertIn(
            "request.email.trim().is_empty() || request.password.is_empty()",
            auth_content,
            "login must validate non-empty email and password",
        )
        self.assertIn(
            "old_password.is_empty()",
            auth_content,
            "change_password must validate non-empty old_password",
        )
        self.assertIn(
            "new_password.len() < 8",
            auth_content,
            "change_password must enforce password length >= 8",
        )


if __name__ == "__main__":
    unittest.main()
