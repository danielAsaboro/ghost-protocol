#!/usr/bin/env python3
"""Prints a WASM file's NEAR code hash: base58 of its sha256."""
import hashlib, sys
A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n = int.from_bytes(hashlib.sha256(open(sys.argv[1], 'rb').read()).digest(), 'big')
s = ''
while n:
    n, r = divmod(n, 58)
    s = A[r] + s
print(s)
