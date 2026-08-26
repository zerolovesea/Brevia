#!/usr/bin/env python3
"""AST-based dead-code analysis for the backend package (analysis only, no edits).

Collects every module-level name and method defined in backend/*.py, then reports
names that are never referenced anywhere else in the package (or in scripts/,
tests, electron/, frontend/ via string references). Output is a candidate list
that still requires manual review.
"""

import ast
import glob
import re
import sys
from collections import defaultdict

BACKEND = "backend"
ALL_FILES = sorted(glob.glob("backend/*.py")) + sorted(glob.glob("scripts/*.py"))
# Files that are entry points / harnesses and may legitimately reference things
# only via strings (dispatch tables).
STR_SOURCES = ["electron/main.js", "electron/main-logic.js", "frontend/backend-client.js"]


def iter_names(node):
    """Yield (name, kind) for definitions inside a node."""
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.FunctionDef) or isinstance(child, ast.AsyncFunctionDef):
            yield child.name, "function"
        elif isinstance(child, ast.ClassDef):
            yield child.name, "class"
        elif isinstance(child, ast.Assign):
            for target in child.targets:
                if isinstance(target, ast.Name):
                    yield target.id, "assign"
        elif isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
            yield child.target.id, "assign"


def collect_definitions():
    """Map module basename -> {name: kind} for module-level definitions."""
    modules = defaultdict(dict)
    for path in ALL_FILES:
        try:
            tree = ast.parse(open(path, encoding="utf-8").read(), path)
        except SyntaxError:
            continue
        base = path.split("\\")[-1].replace(".py", "")
        for name, kind in iter_names(tree):
            modules[base][name] = kind
        # methods of classes
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        modules[base][item.name] = "method"
    return modules


def collect_usage():
    """Return set of identifier-like tokens referenced in all code + string literals."""
    usage = set()
    for path in ALL_FILES + STR_SOURCES:
        try:
            text = open(path, encoding="utf-8").read()
        except OSError:
            continue
        if path.endswith(".py"):
            try:
                tree = ast.parse(text, path)
                for node in ast.walk(tree):
                    if isinstance(node, ast.Name):
                        usage.add(node.id)
                    elif isinstance(node, ast.Attribute):
                        usage.add(node.attr)
                    elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                        for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", node.value):
                            usage.add(token)
            except SyntaxError:
                pass
        else:
            for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text):
                usage.add(token)
    return usage


def main():
    modules = collect_definitions()
    usage = collect_usage()
    for base in sorted(modules):
        unused = [name for name, kind in modules[base].items() if name not in usage]
        if unused:
            print(f"## {base}")
            for name in sorted(unused):
                print(f"   {name} ({modules[base][name]})")


if __name__ == "__main__":
    main()
