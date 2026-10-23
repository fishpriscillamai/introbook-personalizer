#!/usr/bin/env python3
"""Build two host-labelled packages from one skill source (Python stdlib only)."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKILL = next((p for p in (ROOT / 'skills/introbook-personalizer', ROOT / '.agents/skills/introbook-personalizer') if p.is_dir()), ROOT / '.agents/skills/introbook-personalizer')


def build(output: Path, include_templates: bool = False, latest_templates: bool = False):
    output.mkdir(parents=True, exist_ok=True)
    if latest_templates and not include_templates:
        raise ValueError('--latest-templates requires --include-templates')
    selected = set()
    if latest_templates:
        for brand in ('mingdao', 'nocoly'):
            manifests = list((SKILL / 'assets/templates' / brand).glob('*/manifest.json'))
            if manifests:
                selected.add(max(manifests, key=lambda p: json.loads(p.read_text())['registeredAt']).parent)
    files = []
    for item in sorted(SKILL.rglob('*')):
        if item.is_symlink():
            raise ValueError(f'Symlinks may not enter a portable package: {item.name}')
        if not item.is_file() or item.name in {'.DS_Store', '.gitkeep'}:
            continue
        relative = item.relative_to(SKILL)
        if relative.parts[:2] == ('assets', 'templates') and not include_templates:
            continue
        if relative.parts[:2] == ('assets', 'templates') and latest_templates and not any(parent in item.parents for parent in selected):
            continue
        files.append((item, str(Path('introbook-personalizer') / relative)))
    templates = [name for _, name in files if name.endswith('/manifest.json') and '/assets/templates/' in name]
    version_file = SKILL / 'version.json'
    version = json.loads(version_file.read_text())['version'] if version_file.exists() else 'unversioned'
    state = {'schemaVersion': 1, 'version': version, 'standardTemplates': len(templates), 'requiresLatestSources': not bool(templates),
             'hostCompatibility': 'requires actual install and generation verification',
             'included': [{'path': name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file, name in files]}
    outputs = []
    for host in ('codex', 'workbuddy'):
        target = output / f'introbook-personalizer-{host}.zip'
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file, name in files:
                archive.write(file, name)
            archive.writestr('introbook-personalizer/package-state.json', json.dumps(state, ensure_ascii=False, indent=2))
        outputs.append({'host': host, 'file': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                        'standardTemplates': len(templates)})
    return outputs


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'deliveries/skill')
    parser.add_argument('--include-templates', action='store_true')
    parser.add_argument('--latest-templates', action='store_true')
    args = parser.parse_args()
    print(json.dumps(build(args.output.resolve(), args.include_templates, args.latest_templates), ensure_ascii=False, indent=2))
