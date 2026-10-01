# -*- coding: utf-8 -*-
"""Turn the \\uXXXX escapes in game/model.js back into real characters for editing. Run tools/escape.py when done."""
import io, os, re
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game', 'model.js')
s = io.open(p, encoding='utf-8').read()


def un(m):
    if m.group(1):   # a surrogate pair
        hi, lo = int(m.group(1), 16), int(m.group(2), 16)
        return chr(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00))
    return chr(int(m.group(3), 16))


out = re.sub(r'\\u(d[89ab][0-9a-fA-F]{2})\\u(d[c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})', un, s)
io.open(p, 'w', encoding='utf-8', newline='\n').write(out)
print('unescaped', len(s) - len(out), 'chars saved')
