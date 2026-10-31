#!/usr/bin/env python3
"""Extract the central, static character from the user-supplied Sketchfab GLB.

Usage: python3 scripts/prepare-uraraka.py SOURCE.glb OUTPUT.glb
Preserves materials, textures and attribution. No triangles are cut: the source
has three disconnected poses; the central one lies entirely within |x| < .65.
"""
import json
import struct
import sys

source = open(sys.argv[1], 'rb').read()
assert source[:4] == b'glTF' and struct.unpack_from('<I', source, 4)[0] == 2
json_size = struct.unpack_from('<I', source, 12)[0]
doc = json.loads(source[20:20 + json_size])
binary = source[28 + json_size:]
output = bytearray()
views, accessors = [], []


def add_view(data):
    output.extend(b'\0' * (-len(output) % 4))
    views.append({'buffer': 0, 'byteOffset': len(output), 'byteLength': len(data)})
    output.extend(data)
    return len(views) - 1


def read_accessor(index):
    accessor = doc['accessors'][index]
    assert 'sparse' not in accessor
    view = doc['bufferViews'][accessor['bufferView']]
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    fmt = '<' + {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[accessor['componentType']] * components
    size = struct.calcsize(fmt)
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', size)
    return accessor, fmt, [struct.unpack_from(fmt, binary, start + i * stride) for i in range(accessor['count'])]


def add_accessor(template, fmt, values):
    accessor = {key: template[key] for key in ('componentType', 'type', 'normalized') if key in template}
    accessor.update(bufferView=add_view(b''.join(struct.pack(fmt, *value) for value in values)), count=len(values))
    if template['type'] == 'VEC3' and 'min' in template:
        accessor['min'] = [min(axis) for axis in zip(*values)]
        accessor['max'] = [max(axis) for axis in zip(*values)]
    accessors.append(accessor)
    return len(accessors) - 1


assert doc['nodes'][3]['name'] == 'Uraraka_0'
doc['nodes'][2]['children'] = [3]  # Drop the backdrop subtree.
doc['nodes'] = doc['nodes'][:8]
doc['meshes'] = doc['meshes'][:4]
for mesh in doc['meshes']:
    for primitive in mesh['primitives']:
        positions = read_accessor(primitive['attributes']['POSITION'])[2]
        indices = [value[0] for value in read_accessor(primitive['indices'])[2]]
        retained = []
        for i in range(0, len(indices), 3):
            triangle = indices[i:i + 3]
            inside = [abs(positions[index][0]) < .65 for index in triangle]
            assert all(inside) or not any(inside), 'Selection would cut a triangle'
            if all(inside):
                retained.extend(triangle)
        used = sorted(set(retained))
        remap = {old: new for new, old in enumerate(used)}
        for attribute, index in primitive['attributes'].items():
            template, fmt, values = read_accessor(index)
            primitive['attributes'][attribute] = add_accessor(template, fmt, [values[i] for i in used])
        primitive['indices'] = add_accessor({'componentType': 5125, 'type': 'SCALAR'}, '<I', [(remap[i],) for i in retained])

for image in doc['images']:
    view = doc['bufferViews'][image['bufferView']]
    start = view.get('byteOffset', 0)
    image['bufferView'] = add_view(binary[start:start + view['byteLength']])
doc['bufferViews'], doc['accessors'] = views, accessors
doc['buffers'] = [{'byteLength': len(output)}]
doc['asset']['extras']['modifications'] = 'Central pose extracted; side poses and decorative backdrop removed. Static geometry, no rig or animations.'
encoded = json.dumps(doc, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
output.extend(b'\0' * (-len(output) % 4))
result = struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(output))
result += struct.pack('<I4s', len(encoded), b'JSON') + encoded
result += struct.pack('<I4s', len(output), b'BIN\0') + output
with open(sys.argv[2], 'wb') as file:
    file.write(result)
print(f'Wrote {len(result)} bytes, central pose only')
