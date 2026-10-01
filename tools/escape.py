# -*- coding: utf-8 -*-
"""Write game/model.js as pure ASCII (non-ASCII characters become \\uXXXX), so it loads correctly even when the
server sends no charset. Run it after every edit of model.js, before committing. tools/unescape.py reverses it."""
import io, os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game', 'model.js')
s = io.open(p, encoding='utf-8').read()


def esc(ch):
    c = ord(ch)
    if c < 128:
        return ch
    if c > 0xFFFF:   # outside the basic plane: a surrogate pair, as JavaScript expects
        c -= 0x10000
        return '\\u%04x\\u%04x' % (0xD800 + (c >> 10), 0xDC00 + (c & 0x3FF))
    return '\\u%04x' % c


n = sum(1 for ch in s if ord(ch) > 127)
io.open(p, 'w', encoding='ascii', newline='\n').write(''.join(esc(ch) for ch in s))
print('escaped', n, 'non-ASCII chars')
