"""Generate the backend S-57 editing schema from pinned GDAL 3.11.5 dictionaries."""
import csv
import hashlib
import json
import io
from pathlib import Path

root = Path(__file__).resolve().parents[2]
folder = root / 'ENC/schema/gdal-3.11.5'
def rows(name):
    data = (folder / name).read_bytes()
    try:
        text = data.decode('utf8')
    except UnicodeDecodeError:
        text = data.decode('latin1')
    return list(csv.DictReader(io.StringIO(text)))

choices = {}
for row in rows('s57expectedinput.csv'):
    if row['ID'].isdigit():
        choices.setdefault(row['Code'], []).append({'value': int(row['ID']), 'label': row['Meaning']})
labels = {'OBJNAM':'Tên đối tượng','NOBJNM':'Tên bản địa','INFORM':'Thông tin','NINFOM':'Thông tin bản địa','SCAMIN':'Mẫu số tỷ lệ hiển thị tối thiểu','VALSOU':'Độ sâu đo được (m)','HEIGHT':'Chiều cao (m)','ELEVAT':'Cao độ (m)'}
attributes = {}
for row in rows('s57attributes.csv'):
    if row['Class'] != 'F' or not row['Acronym'].isupper():
        continue
    kind = {'E':'enum','L':'list','I':'integer','F':'number'}.get(row['Attributetype'], 'text')
    if kind in ('enum','list') and row['Code'] not in choices:
        continue  # No guessed enumeration domains.
    value = {'key':row['Acronym'],'label':labels.get(row['Acronym'],row['Attribute']),'kind':kind}
    if kind in ('enum','list'):
        value['options'] = choices[row['Code']]
    attributes[row['Acronym']] = value
classes = {}
for row in rows('s57objectclasses.csv'):
    if row['Class'] != 'G' or not row['Acronym'].isupper() or int(row['Code']) > 163:
        continue
    keys = sorted(set(';'.join(row[k] for k in ('Attribute_A','Attribute_B','Attribute_C')).split(';')) & attributes.keys())
    classes[row['Acronym']] = {'label':row['ObjectClass'],'attributes':keys,'primitives':[p for p in row['Primitives'].split(';') if p]}
result = {'source':'OSGeo/GDAL v3.11.5 S-57 dictionaries; editor validation profile, not full ENC product validation',
          'checksums':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.glob('*.csv')},
          'attributes':attributes,'classes':classes}
target = root / 'editor-api/internal/enc/editing_schema.generated.json'
target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n',encoding='utf8')
print(f'Generated {len(classes)} classes, {len(attributes)} attribute definitions.')
