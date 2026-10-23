#!/usr/bin/env python3
"""Export a clean public snapshot from the canonical skill; never copy workspace history/data."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SKILL = next(p for p in (ROOT / 'skills/introbook-personalizer', ROOT / '.agents/skills/introbook-personalizer') if p.is_dir())
SCRIPTS = ('build_packages.py', 'fetch_web_sources.py', 'review_customer_introbook.mjs', 'verify_browser.mjs', 'verify_web_sources.mjs', 'verify_official_templates.mjs', 'prepare_public_release.py')
TESTS = ('core.test.mjs', 'distribution.test.mjs', 'official-web.test.mjs', 'public-release.test.mjs', 'fixtures.mjs', 'test_web_fetch.py')


def copy_code(source, target):
    text = source.read_text()
    text = text.replace('../skills/introbook-personalizer', '../skills/introbook-personalizer')
    text = text.replace("path.join(root,'skills/introbook-personalizer')", "path.join(root,'skills/introbook-personalizer')")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def export(output):
    output = output.resolve()
    if output == ROOT or output in SKILL.parents or SKILL == output or SKILL in output.parents:
        raise ValueError('Public snapshot must not overwrite or be inside the canonical skill')
    output.mkdir(parents=True, exist_ok=False)
    for source in sorted(SKILL.rglob('*')):
        relative = source.relative_to(SKILL)
        if relative.parts[:2] == ('assets', 'templates'):
            continue
        if source.is_symlink():
            raise ValueError(f'Symlink in skill source: {relative}')
        if source.is_file() and source.name != '.DS_Store':
            if source.suffix not in ('.md', '.json', '.mjs', '.js', '.yaml', '.yml'):
                raise ValueError(f'Unexpected public source file: {relative}')
            target = output / 'skills/introbook-personalizer' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    templates = output / 'skills/introbook-personalizer/assets/templates'
    templates.mkdir(parents=True, exist_ok=True)
    (templates / '.gitkeep').write_text('')
    for name in SCRIPTS:
        copy_code(ROOT / 'scripts' / name, output / 'scripts' / name)
    for name in TESTS:
        copy_code(ROOT / 'tests' / name, output / 'tests' / name)
    for name in ('README.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md'):
        source = ROOT / 'publication' / name if (ROOT / 'publication').is_dir() else ROOT / name
        shutil.copyfile(source, output / name)
    workflow = ROOT / 'publication/github-ci.yml' if (ROOT / 'publication').is_dir() else ROOT / '.github/workflows/ci.yml'
    target = output / '.github/workflows/ci.yml'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(workflow, target)
    (output / '.gitignore').write_text('.DS_Store\nnode_modules/\n__pycache__/\n*.pyc\n.work/\ndist/\noutputs/\nmaterials/\n*.zip\nskills/introbook-personalizer/assets/templates/*\n!skills/introbook-personalizer/assets/templates/.gitkeep\n')
    included = [{'path':str(p.relative_to(output)), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(output.rglob('*')) if p.is_file()]
    manifest = {'version':json.loads((SKILL / 'version.json').read_text())['version'], 'files':included, 'templateFilesInGit':0, 'customerOutputsIncluded':False, 'rawKnowledgeRecordsIncluded':False}
    (output / 'publication-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return {'output':str(output),'files':len(included)+1,'version':manifest['version']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    print(json.dumps(export(parser.parse_args().output), ensure_ascii=False, indent=2))
