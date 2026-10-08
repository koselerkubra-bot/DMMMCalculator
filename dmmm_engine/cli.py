import argparse
from pathlib import Path
from .core import parse_batch, build_tracker
p=argparse.ArgumentParser(description='Generate DMMM 2026 tracker from country workbooks')
p.add_argument('--input-folder',required=True); p.add_argument('--output',required=True)
a=p.parse_args(); submissions,errors=parse_batch(a.input_folder)
build_tracker(submissions,a.output)
print(f'Created {a.output}: {len(submissions)} submissions, {len(errors)} unreadable files')
for file,error in errors: print(f'ERROR {file}: {error}')
for s in submissions:
 for issue in s.issues: print(f'WARNING {s.source_file}: {issue}')
